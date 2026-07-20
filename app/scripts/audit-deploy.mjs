#!/usr/bin/env node
// Audit a deployed repo against expected pipeline state to find what failed.
// Uses installation token (mint via App JWT) — same identity the wizard used.
//
//   pnpm exec node scripts/audit-deploy.mjs <installation_id> <owner/repo>
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT, importPKCS8 } from "jose";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = await readFile(join(__dirname, "..", ".env.local"), "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const INSTALLATION_ID = Number(process.argv[2] ?? 147710739);
const REPO = process.argv[3] ?? "akushonkamen/gitautodev-deploy-smoke-1784474393";

const pem = Buffer.from(process.env.APP_PRIVATE_KEY, "base64").toString("utf-8");
const key = await importPKCS8(pem, "RS256");
const now = Math.floor(Date.now() / 1000);
const jwt = await new SignJWT({}).setProtectedHeader({ alg: "RS256" })
  .setIssuer(process.env.APP_ID).setIssuedAt(now).setExpirationTime(now + 9 * 60).sign(key);

const mint = await fetch(`https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens`, {
  method: "POST",
  headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json" },
});
const { token } = await mint.json();
const H = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

console.log(`\n=== Auditing ${REPO} ===\n`);

// 1. Workflows (expected files under .github/workflows/)
const tree = await fetch(`https://api.github.com/repos/${REPO}/git/trees/HEAD?recursive=1`, { headers: H });
const treeData = await tree.json();
const wf = (treeData.tree ?? []).filter((t) => t.path.startsWith(".github/workflows/") && t.type === "blob").map((t) => t.path);
console.log(`📁 .github/workflows/ files: ${wf.length}`);
wf.forEach((p) => console.log(`   ✓ ${p}`));

// 2. Actions variables
const vRes = await fetch(`https://api.github.com/repos/${REPO}/actions/variables?per_page=100`, { headers: H });
console.log(`\n🔢 actions/variables: HTTP ${vRes.status}`);
if (vRes.ok) {
  const v = await vRes.json();
  console.log(`   count: ${v.variables?.length}`);
  v.variables?.forEach((x) => console.log(`   ✓ ${x.name}`));
} else {
  console.log(`   body: ${(await vRes.text()).slice(0, 200)}`);
}

// 3. Actions secrets (names only)
const sRes = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets?per_page=100`, { headers: H });
console.log(`\n🔒 actions/secrets: HTTP ${sRes.status}`);
if (sRes.ok) {
  const s = await sRes.json();
  console.log(`   count: ${s.secrets?.length}`);
  s.secrets?.forEach((x) => console.log(`   ✓ ${x.name}`));
} else {
  console.log(`   body: ${(await sRes.text()).slice(0, 200)}`);
}

// 4. Rulesets (branch protection)
const rRes = await fetch(`https://api.github.com/repos/${REPO}/rulesets?per_page=100`, { headers: H });
console.log(`\n🛡️  rulesets: HTTP ${rRes.status}`);
if (rRes.ok) {
  const r = await rRes.json();
  console.log(`   count: ${r.length}`);
  r.forEach((x) => console.log(`   ✓ #${x.id} ${x.targeting} → ${JSON.stringify(x.conditions?.ref_name ?? x.conditions)} | ${x.enforcement}`));
} else {
  console.log(`   body: ${(await rRes.text()).slice(0, 200)}`);
}

// 5. Labels (expected ~49)
const lRes = await fetch(`https://api.github.com/repos/${REPO}/labels?per_page=100`, { headers: H });
console.log(`\n🏷️  labels: HTTP ${lRes.status}`);
if (lRes.ok) {
  const l = await lRes.json();
  console.log(`   count: ${l.length}`);
} else {
  console.log(`   body: ${(await lRes.text()).slice(0, 200)}`);
}
