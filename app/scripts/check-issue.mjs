#!/usr/bin/env node
// Print labels + comments for an Issue by number.
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

const INSTALLATION_ID = 147710739;
const REPO = "akushonkamen/gitautodev-deploy-smoke-1784474393";
const ISSUE = Number(process.argv[2] ?? 10);

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

const iRes = await fetch(`https://api.github.com/repos/${REPO}/issues/${ISSUE}`, { headers: H });
const i = await iRes.json();
console.log(`Issue #${i.number}: ${i.title}`);
console.log(`  state: ${i.state}`);
console.log(`  labels: ${(i.labels ?? []).map((l) => l.name).join(", ") || "(none)"}`);

const cRes = await fetch(`https://api.github.com/repos/${REPO}/issues/${ISSUE}/comments`, { headers: H });
const cs = await cRes.json();
console.log(`\ncomments (${cs.length}):`);
for (const c of cs) {
  console.log(`\n  @${c.user?.login} at ${c.created_at}:`);
  console.log(`  ${c.body?.slice(0, 1200)}`);
}
