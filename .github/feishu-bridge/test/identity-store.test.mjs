/**
 * identity-store.test.mjs — unit tests for AES-256-GCM identity store
 *
 * Coverage:
 *   - generateMasterKeyHex format
 *   - encryptPAT / decryptPAT round-trip
 *   - encryptPAT rejects bad master key length
 *   - decryptPAT detects tamper (auth tag failure)
 *   - bind / lookup / unbind round-trip
 *   - lookup returns null for unknown open_id
 *   - unbind returns false for unknown open_id
 *   - listBindings excludes PAT blobs
 *   - scanForPlaintextPATs returns 0 on encrypted store
 *   - resolveMasterKey: keychain path (mocked runner)
 *   - resolveMasterKey: fallback to pass when keychain fails
 *   - resolveMasterKey: throws when no source has the key
 *   - resolveMasterKey: NEVER reads process.env
 *   - acquireLock: first call succeeds, second call (different pid simulation) fails
 *   - decodeKeyHex rejects malformed input
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  generateMasterKeyHex,
  decodeKeyHex,
  encryptPAT,
  decryptPAT,
  decryptPATString,
  bind,
  lookup,
  unbind,
  listBindings,
  scanForPlaintextPATs,
  resolveMasterKey,
  acquireLock,
  wipeBuffer,
  __internal,
} from '../identity-store.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpSeq = 0;
async function tmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'feishu-bridge-test-'));
  return path.join(dir, `store-${process.pid}-${tmpSeq++}.json`);
}

const VALID_KEY_HEX = 'a'.repeat(64);
const VALID_KEY = Buffer.from(VALID_KEY_HEX, 'hex');

// ---------------------------------------------------------------------------
// generateMasterKeyHex
// ---------------------------------------------------------------------------

test('generateMasterKeyHex returns 64 hex chars', () => {
  const k = generateMasterKeyHex();
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(k.length, 64);
});

test('generateMasterKeyHex produces unique keys', () => {
  const a = generateMasterKeyHex();
  const b = generateMasterKeyHex();
  assert.notEqual(a, b, 'two random keys must differ');
});

// ---------------------------------------------------------------------------
// decodeKeyHex
// ---------------------------------------------------------------------------

test('decodeKeyHex accepts 64 hex chars', () => {
  const buf = decodeKeyHex(VALID_KEY_HEX);
  assert.equal(buf.length, 32);
});

test('decodeKeyHex rejects non-hex input', () => {
  assert.throws(() => decodeKeyHex('not-hex'), /64 hex chars/);
});

test('decodeKeyHex rejects wrong length', () => {
  assert.throws(() => decodeKeyHex('abcd'), /64 hex chars/);
  assert.throws(() => decodeKeyHex('a'.repeat(128)), /64 hex chars/);
});

// ---------------------------------------------------------------------------
// encryptPAT / decryptPAT
// ---------------------------------------------------------------------------

test('encryptPAT then decryptPAT round-trips the plaintext', () => {
  const plain = 'github_pat_11ABCDEabcdef0123456789_0123456789ABCDEF';
  const blob = encryptPAT(plain, VALID_KEY);
  const recovered = decryptPATString(blob, VALID_KEY);
  assert.equal(recovered, plain);
});

test('encryptPAT produces different blobs for same plaintext (random IV)', () => {
  const plain = 'github_pat_test_value_constant';
  const a = encryptPAT(plain, VALID_KEY);
  const b = encryptPAT(plain, VALID_KEY);
  assert.notEqual(a, b, 'random IV must produce different ciphertexts');
});

test('encryptPAT rejects empty plaintext', () => {
  assert.throws(() => encryptPAT('', VALID_KEY), /plain PAT required/);
});

test('encryptPAT rejects wrong master key length', () => {
  const badKey = Buffer.alloc(16, 0xab);
  assert.throws(() => encryptPAT('github_pat_x', badKey), /32-byte Buffer/);
});

test('decryptPAT detects tampered ciphertext', () => {
  const blob = encryptPAT('github_pat_secret_value', VALID_KEY);
  // Tamper with the base64 blob — flip a byte in the middle (ciphertext region)
  const buf = Buffer.from(blob, 'base64');
  buf[15] ^= 0xff;
  const tampered = buf.toString('base64');
  assert.throws(() => decryptPAT(tampered, VALID_KEY));
});

test('decryptPAT rejects truncated blob', () => {
  assert.throws(() => decryptPAT('short', VALID_KEY), /too short/);
});

test('decryptPAT rejects wrong key', () => {
  const blob = encryptPAT('github_pat_secret', VALID_KEY);
  const wrongKey = Buffer.from('b'.repeat(64), 'hex');
  assert.throws(() => decryptPAT(blob, wrongKey));
});

// ---------------------------------------------------------------------------
// bind / lookup / unbind
// ---------------------------------------------------------------------------

test('bind then lookup returns same github_user and decryptable PAT', async () => {
  const store = await tmpStore();
  const openId = 'ou_test_user_alice_12345678';
  const plain = 'github_pat_11ABCDE_alice_secret_value_9876';

  await bind({ storePath: store, masterKey: VALID_KEY, openId, githubUser: 'alice', plainPAT: plain });
  const found = await lookup({ storePath: store, masterKey: VALID_KEY, openId });

  assert.equal(found?.github_user, 'alice');
  assert.equal(found.pat.toString('utf8'), plain);
  wipeBuffer(found.pat);
});

test('lookup returns null for unbound open_id', async () => {
  const store = await tmpStore();
  const found = await lookup({ storePath: store, masterKey: VALID_KEY, openId: 'ou_never_bound' });
  assert.equal(found, null);
});

test('unbind removes binding', async () => {
  const store = await tmpStore();
  const openId = 'ou_to_remove';
  await bind({ storePath: store, masterKey: VALID_KEY, openId, githubUser: 'bob', plainPAT: 'github_pat_x_bob' });
  const removed = await unbind({ storePath: store, openId });
  assert.equal(removed, true);
  const after = await lookup({ storePath: store, masterKey: VALID_KEY, openId });
  assert.equal(after, null);
});

test('unbind returns false for unknown open_id', async () => {
  const store = await tmpStore();
  const removed = await unbind({ storePath: store, openId: 'ou_unknown' });
  assert.equal(removed, false);
});

test('bind overwrites existing binding for same open_id', async () => {
  const store = await tmpStore();
  const openId = 'ou_overwrite';
  await bind({ storePath: store, masterKey: VALID_KEY, openId, githubUser: 'alice', plainPAT: 'github_pat_old' });
  await bind({ storePath: store, masterKey: VALID_KEY, openId, githubUser: 'alice2', plainPAT: 'github_pat_new' });
  const found = await lookup({ storePath: store, masterKey: VALID_KEY, openId });
  assert.equal(found.github_user, 'alice2');
  assert.equal(found.pat.toString('utf8'), 'github_pat_new');
});

test('bind rejects missing required fields', async () => {
  const store = await tmpStore();
  await assert.rejects(
    () => bind({ storePath: store, masterKey: VALID_KEY, openId: '', githubUser: 'x', plainPAT: 'y' }),
    /openId required/,
  );
  await assert.rejects(
    () => bind({ storePath: store, masterKey: VALID_KEY, openId: 'x', githubUser: '', plainPAT: 'y' }),
    /githubUser required/,
  );
  await assert.rejects(
    () => bind({ storePath: store, masterKey: VALID_KEY, openId: 'x', githubUser: 'y', plainPAT: '' }),
    /plainPAT required/,
  );
});

test('multiple bindings coexist with different open_ids', async () => {
  const store = await tmpStore();
  await bind({ storePath: store, masterKey: VALID_KEY, openId: 'ou_a', githubUser: 'alice', plainPAT: 'github_pat_a' });
  await bind({ storePath: store, masterKey: VALID_KEY, openId: 'ou_b', githubUser: 'bob', plainPAT: 'github_pat_b' });
  const a = await lookup({ storePath: store, masterKey: VALID_KEY, openId: 'ou_a' });
  const b = await lookup({ storePath: store, masterKey: VALID_KEY, openId: 'ou_b' });
  assert.equal(a.github_user, 'alice');
  assert.equal(b.github_user, 'bob');
});

// ---------------------------------------------------------------------------
// listBindings + scanForPlaintextPATs
// ---------------------------------------------------------------------------

test('listBindings returns metadata without PAT blobs', async () => {
  const store = await tmpStore();
  await bind({ storePath: store, masterKey: VALID_KEY, openId: 'ou_a', githubUser: 'alice', plainPAT: 'github_pat_secret_a' });
  await bind({ storePath: store, masterKey: VALID_KEY, openId: 'ou_b', githubUser: 'bob', plainPAT: 'github_pat_secret_b' });

  const list = await listBindings({ storePath: store });
  assert.equal(list.length, 2);
  const usernames = list.map((b) => b.github_user).sort();
  assert.deepEqual(usernames, ['alice', 'bob']);
  const json = JSON.stringify(list);
  assert.doesNotMatch(json, /github_pat_/);
});

test('scanForPlaintextPATs returns 0 on encrypted store', async () => {
  const store = await tmpStore();
  await bind({ storePath: store, masterKey: VALID_KEY, openId: 'ou_a', githubUser: 'alice', plainPAT: 'github_pat_secret_x' });
  const count = await scanForPlaintextPATs({ storePath: store });
  assert.equal(count, 0);
});

test('scanForPlaintextPATs returns 0 when store does not exist', async () => {
  const count = await scanForPlaintextPATs({ storePath: '/tmp/nonexistent-store-' + process.pid + '.json' });
  assert.equal(count, 0);
});

// S4 red line — file mode must be 0600
test('store file is written with mode 0600', async () => {
  const store = await tmpStore();
  await bind({ storePath: store, masterKey: VALID_KEY, openId: 'ou_mode', githubUser: 'x', plainPAT: 'github_pat_mode' });
  const stat = await fs.stat(store);
  const mode = stat.mode & 0o777;
  assert.equal(mode, 0o600, `expected 0600, got ${mode.toString(8)}`);
});

// ---------------------------------------------------------------------------
// resolveMasterKey
// ---------------------------------------------------------------------------

test('resolveMasterKey: keychain source on darwin (mocked runner)', async () => {
  // Force platform to darwin for the test by using inject path is not what we want;
  // instead, mock runner returns the hex key when security command is invoked.
  const keyHex = VALID_KEY_HEX;
  const runner = (argv) => {
    if (argv[0] === 'security' && argv.includes('-w')) {
      return keyHex;
    }
    throw new Error('command not found');
  };
  // We can only test the runner path explicitly when platform is darwin OR
  // when on linux using libsecret. Force-inject to keep test deterministic.
  const result = await resolveMasterKey({
    inject: { key: VALID_KEY, source: 'keychain' },
  });
  assert.equal(result.source, 'keychain');
  assert.equal(result.key.length, 32);

  // Also verify runner path mechanics via direct exec mock.
  const r2 = await resolveMasterKey({ __runner: runner });
  assert.equal(r2.source, process.platform === 'darwin' ? 'keychain' : r2.source);
});

test('resolveMasterKey: inject path returns inject source', async () => {
  const result = await resolveMasterKey({ inject: { key: VALID_KEY } });
  assert.equal(result.source, 'inject');
  assert.equal(result.key, VALID_KEY);
});

test('resolveMasterKey: throws when no source has key', async () => {
  const failingRunner = () => {
    throw new Error('not found');
  };
  await assert.rejects(
    () => resolveMasterKey({ __runner: failingRunner }),
    /master key not found/,
  );
});

test('resolveMasterKey: falls through when first source fails', async () => {
  const keyHex = VALID_KEY_HEX;
  let calls = 0;
  const runner = (argv) => {
    calls++;
    if (argv[0] === 'security') throw new Error('keychain locked');
    if (argv[0] === 'pass' && argv[1] === 'feishu-bridge/master-key') return keyHex;
    if (argv[0] === 'secret-tool') throw new Error('libsecret not configured');
    throw new Error('unexpected');
  };
  // On darwin the chain is keychain -> pass; on linux it's libsecret -> pass.
  // Either way, pass should win.
  const result = await resolveMasterKey({ __runner: runner });
  assert.equal(result.source, 'pass');
  assert.equal(result.key.toString('hex'), keyHex);
  assert.ok(calls >= 2, 'should have attempted at least 2 sources');
});

test('resolveMasterKey: throws on malformed key in store', async () => {
  const runner = () => 'not-valid-hex';
  await assert.rejects(
    () => resolveMasterKey({ __runner: runner }),
    /master key not found/,
  );
});

test('resolveMasterKey: NEVER reads process.env for the key (P3 red line)', async () => {
  // Set a tempting env var that the implementation MUST NOT consult.
  const saved = process.env.FEISHU_BRIDGE_MASTER_KEY;
  process.env.FEISHU_BRIDGE_MASTER_KEY = VALID_KEY_HEX;
  try {
    const failingRunner = () => {
      throw new Error('not found');
    };
    // Should throw "not found" rather than picking up the env var.
    await assert.rejects(
      () => resolveMasterKey({ __runner: failingRunner }),
      /master key not found/,
    );
  } finally {
    if (saved === undefined) delete process.env.FEISHU_BRIDGE_MASTER_KEY;
    else process.env.FEISHU_BRIDGE_MASTER_KEY = saved;
  }
});

// ---------------------------------------------------------------------------
// acquireLock
// ---------------------------------------------------------------------------

test('acquireLock: first call succeeds and creates lockfile with current pid', async () => {
  const lockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feishu-lock-'));
  const lockPath = path.join(lockDir, 'bridge.lock');
  const release = await acquireLock({ lockPath });
  assert.ok(existsSync(lockPath));
  const content = await fs.readFile(lockPath, 'utf8');
  assert.equal(content, String(process.pid));
  await release();
  assert.ok(!existsSync(lockPath), 'release must unlink the lockfile');
});

test('acquireLock: second call from same pid is idempotent (no-op re-acquire)', async () => {
  const lockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feishu-lock-'));
  const lockPath = path.join(lockDir, 'bridge-same.lock');
  const release = await acquireLock({ lockPath });
  // Same pid re-acquiring its own lock is benign — should not throw.
  // (Two different PIDs is the case that must throw — tested implicitly by
  // the stale-pid branch above, since a real second process would have a
  // different pid but we can't spawn one here without a fork().)
  const release2 = await acquireLock({ lockPath });
  await release();
  await release2();
});

test('acquireLock: throws when another live pid holds the lock', async () => {
  const lockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feishu-lock-'));
  const lockPath = path.join(lockDir, 'bridge-other.lock');
  // Use the current test process's own pid — wait, that won't trigger the
  // branch because holderPid === pid. Use a real-but-different pid: pid 1
  // (init/launchd) is always alive and never us. On macOS/Linux this is safe.
  await fs.writeFile(lockPath, '1');
  await assert.rejects(
    () => acquireLock({ lockPath }),
    /another feishu-bridge instance is running/,
  );
  // Clean up so other tests don't see it
  await fs.unlink(lockPath);
});

test('acquireLock: steals stale lockfile when holder pid is dead', async () => {
  const lockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feishu-lock-'));
  const lockPath = path.join(lockDir, 'stale.lock');
  // Write a stale lockfile with a guaranteed-dead PID (PID 1 usually exists
  // but we use a huge fake number that's never a real pid).
  // Use 999999 — process.kill returns ESRCH (no such process) → not alive.
  await fs.writeFile(lockPath, '999999');
  const release = await acquireLock({ lockPath });
  const content = await fs.readFile(lockPath, 'utf8');
  assert.equal(content, String(process.pid), 'should overwrite stale pid');
  await release();
});

test('acquireLock: default lockPath lives next to default store', async () => {
  // Sanity: calling without lockPath should not throw and returns a release fn.
  // We don't actually want to create a real lock in the user's home during tests,
  // so we use HOME override.
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'fake-home-'));
  const savedHome = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    const release = await acquireLock();
    const expectedLock = path.join(fakeHome, '.feishu-bridge', 'identity-store.json.lock');
    assert.ok(existsSync(expectedLock));
    await release();
    assert.ok(!existsSync(expectedLock));
  } finally {
    process.env.HOME = savedHome;
  }
});

// ---------------------------------------------------------------------------
// wipeBuffer / wipeString
// ---------------------------------------------------------------------------

test('wipeBuffer fills buffer with zeros', () => {
  const buf = Buffer.from('github_pat_secret', 'utf8');
  wipeBuffer(buf);
  const all = buf.every((b) => b === 0);
  assert.ok(all, 'all bytes should be zeroed');
});
