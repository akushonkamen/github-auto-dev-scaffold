#!/usr/bin/env node
// One-shot: fetch installation info from GitHub App API and upsert into
// the local Postgres DB. Use when the webhook can't reach localhost (e.g.
// cloudflared tunnel dead behind GFW).
//
//   pnpm exec node scripts/sync-installation.mjs <installation_id>
//
// Reads .env.local for APP_ID, APP_PRIVATE_KEY, DATABASE_URL.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT, importPKCS8 } from "jose";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", ".env.local");

function parseEnv(text) {
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

const envText = await readFile(ENV_PATH, "utf8");
const env = parseEnv(envText);
for (const [k, v] of Object.entries(env)) {
  if (!process.env[k]) process.env[k] = v;
}

const APP_ID = process.env.APP_ID;
const PRIVATE_KEY_B64 = process.env.APP_PRIVATE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const INSTALLATION_ID = Number(process.argv[2] ?? 147710739);

if (!APP_ID || !PRIVATE_KEY_B64 || !DATABASE_URL) {
  console.error("Missing APP_ID / APP_PRIVATE_KEY / DATABASE_URL in .env.local");
  process.exit(1);
}

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) {
  console.log(`Using proxy: ${proxyUrl}`);
  const { ProxyAgent } = await import("undici");
  const dispatcher = new ProxyAgent(proxyUrl);
  globalThis[Symbol.for("undici.globalDispatcher.1")] = dispatcher;
}

async function signAppJwt() {
  const pem = Buffer.from(PRIVATE_KEY_B64, "base64").toString("utf-8");
  const key = await importPKCS8(pem, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({}).setProtectedHeader({ alg: "RS256" })
    .setIssuer(String(APP_ID))
    .setIssuedAt(now)
    .setExpirationTime(now + 9 * 60)
    .sign(key);
}

const ghCommonHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "GithubAutoDev-SyncScript",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function gh(path, jwt) {
  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  const res = await fetch(url, {
    headers: { ...ghCommonHeaders, Authorization: `Bearer ${jwt}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub ${url} HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

console.log(`Fetching installation ${INSTALLATION_ID}...`);
const jwt = await signAppJwt();
const inst = await gh(`/app/installations/${INSTALLATION_ID}`, jwt);
console.log(`  account: ${inst.account?.login} (id=${inst.account?.id}, type=${inst.account?.type})`);
console.log(`  target: ${inst.target_type}`);
console.log(`  app_id: ${inst.app_id}`);

// Mint an installation-scoped token. The App JWT can fetch installation
// metadata but NOT /repositories — that requires an installation token.
const tokenRes = await fetch(
  `https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens`,
  { method: "POST", headers: { ...ghCommonHeaders, Authorization: `Bearer ${jwt}` } },
);
if (!tokenRes.ok) {
  const t = await tokenRes.text();
  throw new Error(`mint installation token HTTP ${tokenRes.status}: ${t.slice(0, 300)}`);
}
const { token: installationToken } = await tokenRes.json();
console.log(`  installation token minted`);

// installation-token-scoped endpoint is /installation/repositories
const reposRes = await gh(`/installation/repositories?per_page=100`, installationToken);
const repos = reposRes.repositories ?? [];
console.log(`  repos (${repos.length}):`);
for (const r of repos) console.log(`    - ${r.full_name}`);

if (repos.length === 0) {
  console.error("No repos selected for this installation. Aborting.");
  process.exit(2);
}

const primaryRepo = repos[0].full_name;
const accountLogin = inst.account.login;
const accountGithubId = inst.account.id;

console.log(`\nUpserting tenant (${accountLogin}) + installation (${primaryRepo})...`);
const pool = new Pool({ connectionString: DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO tenants (github_id, github_login, plan)
     VALUES ($1, $2, 'free')
     ON CONFLICT (github_id) DO UPDATE SET github_login = EXCLUDED.github_login`,
    [accountGithubId, accountLogin],
  );
  const { rows } = await client.query(
    `SELECT id FROM tenants WHERE github_id = $1`,
    [accountGithubId],
  );
  const tenantId = rows[0]?.id;
  if (!tenantId) throw new Error("tenant row missing after upsert");

  const ins = await client.query(
    `INSERT INTO installations (installation_id, tenant_id, repo_full_name, uninstalled_at)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT (installation_id) DO UPDATE
       SET tenant_id = EXCLUDED.tenant_id,
           repo_full_name = EXCLUDED.repo_full_name,
           uninstalled_at = NULL
     RETURNING id, (xmax = 0) AS inserted`,
    [INSTALLATION_ID, tenantId, primaryRepo],
  );
  await client.query("COMMIT");
  console.log(`\n✅ installation row: id=${ins.rows[0].id} (${ins.rows[0].inserted ? "CREATED" : "UPDATED"})`);
  console.log(`   DB id is ${ins.rows[0].id} → dashboard URL: /dashboard/installations/${ins.rows[0].id}`);
} catch (e) {
  await client.query("ROLLBACK");
  console.error("DB error:", e);
  process.exit(3);
} finally {
  client.release();
  await pool.end();
}
