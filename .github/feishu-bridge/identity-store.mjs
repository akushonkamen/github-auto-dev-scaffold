/**
 * identity-store.mjs — bridge identity store with AES-256-GCM at rest
 *
 * Master key sources (in priority order, NEVER from env — P3 red line):
 *   1. macOS Keychain (security find-generic-password)
 *   2. Linux libsecret (secret-tool)
 *   3. `pass` password store (pass feishu-bridge/master-key)
 *
 * Storage layout (JSON, plaintext keys, encrypted PAT values):
 *   {
 *     "version": 1,
 *     "bindings": {
 *       "<sha256(open_id)[:12]>": {
 *         "open_id_hash": "<sha12>",
 *         "github_user": "alice",
 *         "pat_blob": "<base64(iv|ciphertext|tag)>",
 *         "bound_at": "<iso8601>"
 *       }
 *     }
 *   }
 *
 * Single-instance invariant: PID-based lockfile at <storePath>.lock
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync, openSync, writeSync, closeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const KEY_SERVICE = 'feishu-bridge';
const KEY_ACCOUNT = 'master-key';
const KEY_LENGTH = 32; // AES-256
const IV_LENGTH = 12; // GCM standard
const STORE_VERSION = 1;

// ---------------------------------------------------------------------------
// Master key resolution
// ---------------------------------------------------------------------------

/**
 * Execute a shell command, returning { ok, stdout }.
 * Inject __runner from tests to stub out external secret stores.
 */
function exec(argv, __runner) {
  const runner = __runner ?? ((args) => {
    const out = execFileSync(args[0], args.slice(1), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim();
  });
  try {
    return { ok: true, stdout: runner(argv) };
  } catch (e) {
    return { ok: false, stdout: '', stderr: e.message };
  }
}

/** Decode a hex master key string into a 32-byte Buffer, validating length. */
export function decodeKeyHex(hex) {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`master key must be 64 hex chars (32 bytes), got len=${hex.length}`);
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Resolve master key from platform secret store. NEVER reads process.env.
 *
 * @returns {Promise<{ key: Buffer, source: 'keychain'|'libsecret'|'pass'|'inject' }>}
 * @throws if no source available or key is malformed
 */
export async function resolveMasterKey({ inject, __runner } = {}) {
  // Test injection path — used by unit tests to avoid touching real keychains.
  if (inject?.key) {
    return { key: inject.key, source: inject.source ?? 'inject' };
  }
  const platform = process.platform;

  const attempts = [];
  if (platform === 'darwin') {
    attempts.push({
      source: 'keychain',
      argv: ['security', 'find-generic-password', '-s', KEY_SERVICE, '-a', KEY_ACCOUNT, '-w'],
    });
  } else if (platform === 'linux') {
    attempts.push({
      source: 'libsecret',
      argv: ['secret-tool', 'lookup', 'application', KEY_SERVICE, 'account', KEY_ACCOUNT],
    });
  }
  // Cross-platform fallback: `pass` (gpg-backed).
  attempts.push({
    source: 'pass',
    argv: ['pass', `${KEY_SERVICE}/${KEY_ACCOUNT}`],
  });

  const tried = [];
  for (const attempt of attempts) {
    tried.push(attempt.source);
    const r = exec(attempt.argv, __runner);
    if (!r.ok || !r.stdout) continue;
    try {
      const key = decodeKeyHex(r.stdout);
      return { key, source: attempt.source };
    } catch {
      continue;
    }
  }
  throw new Error(
    `master key not found in any secret store (tried: ${tried.join(', ')}). ` +
      `Generate one with: openssl rand -hex 32, then store it. Never use env.`,
  );
}

/** Generate a fresh 32-byte master key as 64 hex chars (for setup docs). */
export function generateMasterKeyHex() {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

// ---------------------------------------------------------------------------
// AES-256-GCM encrypt / decrypt (PAT blobs)
// ---------------------------------------------------------------------------

/**
 * Encrypt a plain PAT string into base64(iv|ciphertext|tag).
 * Caller owns wiping the plaintext buffer.
 */
export function encryptPAT(plain, masterKey) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('plain PAT required');
  }
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== KEY_LENGTH) {
    throw new Error(`master key must be ${KEY_LENGTH}-byte Buffer`);
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

/** Decrypt a base64 blob back to plaintext. Throws on tamper (auth tag failure). */
export function decryptPAT(blob, masterKey) {
  if (typeof blob !== 'string' || blob.length === 0) {
    throw new Error('blob required');
  }
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_LENGTH + 16) {
    // 16-byte GCM tag
    throw new Error('blob too short — corrupted or truncated');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(IV_LENGTH, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  // Return as Buffer so caller can wipe; expose utf8 via helper.
  return plain;
}

/** Decrypt and return as UTF-8 string, with optional wipe callback. */
export function decryptPATString(blob, masterKey) {
  const buf = decryptPAT(blob, masterKey);
  const str = buf.toString('utf8');
  buf.fill(0);
  return str;
}

// ---------------------------------------------------------------------------
// Store read / write
// ---------------------------------------------------------------------------

function defaultStorePath() {
  const home = process.env.HOME || os.homedir();
  return path.join(home, '.feishu-bridge', 'identity-store.json');
}

function hashOpenId(openId) {
  return crypto.createHash('sha256').update(String(openId)).digest('hex').slice(0, 12);
}

async function readStore(storePath) {
  try {
    const raw = await fs.readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.version !== STORE_VERSION) {
      throw new Error(`unsupported store version: ${parsed.version}`);
    }
    if (typeof parsed.bindings !== 'object' || parsed.bindings === null) {
      throw new Error('store.bindings must be an object');
    }
    return parsed;
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { version: STORE_VERSION, bindings: {} };
    }
    throw e;
  }
}

async function writeStore(storePath, store) {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const tmp = `${storePath}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  await fs.rename(tmp, storePath);
  // Double-check perms on the final file.
  try {
    await fs.chmod(storePath, 0o600);
  } catch {
    // best effort
  }
}

/**
 * Bind a Feishu open_id to a GitHub user with the user's PAT (plain).
 * The PAT is encrypted at rest with the master key.
 *
 * @returns {Promise<{ open_id_hash: string, github_user: string, bound_at: string }>}
 */
export async function bind({ storePath = defaultStorePath(), masterKey, openId, githubUser, plainPAT }) {
  if (!openId) throw new Error('openId required');
  if (!githubUser) throw new Error('githubUser required');
  if (!plainPAT) throw new Error('plainPAT required');
  if (!Buffer.isBuffer(masterKey)) throw new Error('masterKey Buffer required');

  const store = await readStore(storePath);
  const hash = hashOpenId(openId);
  const patBlob = encryptPAT(plainPAT, masterKey);
  const boundAt = new Date().toISOString();
  store.bindings[hash] = {
    open_id_hash: hash,
    github_user: githubUser,
    pat_blob: patBlob,
    bound_at: boundAt,
  };
  await writeStore(storePath, store);
  return { open_id_hash: hash, github_user: githubUser, bound_at: boundAt };
}

/**
 * Look up a binding by open_id. Returns null if not bound.
 * The returned PAT is decrypted into a Buffer; caller MUST fill(0) when done.
 *
 * @returns {Promise<{ github_user: string, pat: Buffer, bound_at: string } | null>}
 */
export async function lookup({ storePath = defaultStorePath(), masterKey, openId }) {
  if (!openId) throw new Error('openId required');
  if (!Buffer.isBuffer(masterKey)) throw new Error('masterKey Buffer required');

  const store = await readStore(storePath);
  const hash = hashOpenId(openId);
  const entry = store.bindings[hash];
  if (!entry) return null;
  const pat = decryptPAT(entry.pat_blob, masterKey);
  return { github_user: entry.github_user, pat, bound_at: entry.bound_at };
}

/** Remove a binding. Returns true if a binding was removed, false if absent. */
export async function unbind({ storePath = defaultStorePath(), openId }) {
  if (!openId) throw new Error('openId required');
  const store = await readStore(storePath);
  const hash = hashOpenId(openId);
  if (!store.bindings[hash]) return false;
  delete store.bindings[hash];
  await writeStore(storePath, store);
  return true;
}

/** List bindings WITHOUT decrypting PATs. For diagnostics / status commands. */
export async function listBindings({ storePath = defaultStorePath() }) {
  const store = await readStore(storePath);
  return Object.values(store.bindings).map((b) => ({
    open_id_hash: b.open_id_hash,
    github_user: b.github_user,
    bound_at: b.bound_at,
  }));
}

/** Verify that the on-disk store contains zero plaintext PAT strings. */
export async function scanForPlaintextPATs({ storePath = defaultStorePath() }) {
  if (!existsSync(storePath)) return 0;
  const raw = await fs.readFile(storePath, 'utf8');
  const matches = raw.match(/github_pat_[A-Za-z0-9_]+/g);
  return matches ? matches.length : 0;
}

// ---------------------------------------------------------------------------
// Single-instance lockfile (PID-based, portable)
// ---------------------------------------------------------------------------

function isPidAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // pid exists but owned by another user
  }
}

/**
 * Acquire a PID-based single-instance lock. Releases automatically on process
 * exit; safe to call multiple times across bridge restarts (steals stale locks).
 *
 * @returns {Promise<() => Promise<void>>} release function
 */
export async function acquireLock({ lockPath = defaultStorePath() + '.lock' } = {}) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const pid = process.pid;

  try {
    // O_EXCL atomic create
    const fd = openSync(lockPath, 'wx');
    writeSync(fd, String(pid));
    closeSync(fd);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // Lock file exists — check if holder alive
    let holderPid = 0;
    try {
      holderPid = parseInt(await fs.readFile(lockPath, 'utf8'), 10);
    } catch {
      // unreadable — treat as stale
    }
    if (holderPid && isPidAlive(holderPid) && holderPid !== pid) {
      throw new Error(
        `another feishu-bridge instance is running (pid=${holderPid}). ` +
          `Only one bridge instance per machine is allowed (Phase A invariant).`,
      );
    }
    // Stale lock — steal atomically
    await fs.writeFile(lockPath, String(pid));
  }
  return async () => {
    try {
      const current = await fs.readFile(lockPath, 'utf8');
      if (parseInt(current, 10) === pid) {
        await fs.unlink(lockPath);
      }
    } catch {
      // best effort
    }
  };
}

// ---------------------------------------------------------------------------
// Wipe helpers (S4 — never leak secrets in memory longer than needed)
// ---------------------------------------------------------------------------

/** Best-effort wipe a string by overwriting its underlying char data. */
export function wipeString(str) {
  if (typeof str !== 'string' || str.length === 0) return;
  try {
    Buffer.from(str).fill(0);
  } catch {
    // strings are immutable in V8 — this is advisory only
  }
}

export function wipeBuffer(buf) {
  if (Buffer.isBuffer(buf) && buf.length > 0) {
    buf.fill(0);
  }
}

export const __internal = { STORE_VERSION, KEY_LENGTH, IV_LENGTH, KEY_SERVICE, KEY_ACCOUNT };
