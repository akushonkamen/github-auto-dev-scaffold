#!/usr/bin/env node
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

const APP_ID = process.env.APP_ID;
const PRIVATE_KEY_B64 = process.env.APP_PRIVATE_KEY;
const INSTALLATION_ID = Number(process.argv[2] ?? 147710739);
const REPO = process.argv[3] ?? "akushonkamen/gitautodev-deploy-smoke-1784474393";

const pem = Buffer.from(PRIVATE_KEY_B64, "base64").toString("utf-8");
const key = await importPKCS8(pem, "RS256");
const now = Math.floor(Date.now() / 1000);
const jwt = await new SignJWT({}).setProtectedHeader({ alg: "RS256" })
  .setIssuer(String(APP_ID)).setIssuedAt(now).setExpirationTime(now + 9 * 60).sign(key);

const r = await fetch(`https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens`, {
  method: "POST",
  headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json" },
});
const data = await r.json();
console.log("Installation token permissions:");
console.log(JSON.stringify(data.permissions, null, 2));

const vRes = await fetch(`https://api.github.com/repos/${REPO}/actions/variables?per_page=5`, {
  headers: { Authorization: `Bearer ${data.token}`, Accept: "application/vnd.github+json" },
});
console.log(`\nGET /repos/${REPO}/actions/variables → ${vRes.status}`);
if (!vRes.ok) console.log("Body:", (await vRes.text()).slice(0, 300));
else console.log("Variables count:", (await vRes.json()).variables?.length);

const cRes = await fetch(`https://api.github.com/repos/${REPO}`, {
  headers: { Authorization: `Bearer ${data.token}`, Accept: "application/vnd.github+json" },
});
console.log(`\nGET /repos/${REPO} → ${cRes.status} (contents check)`);
