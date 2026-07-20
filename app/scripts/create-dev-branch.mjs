#!/usr/bin/env node
// Create `dev` branch on smoke repo from main sha.
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

const refRes = await fetch(`https://api.github.com/repos/${REPO}/git/refs/heads/main`, { headers: H });
const ref = await refRes.json();
const mainSha = ref.object.sha;
console.log(`main sha: ${mainSha}`);

const createRes = await fetch(`https://api.github.com/repos/${REPO}/git/refs`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ ref: "refs/heads/dev", sha: mainSha }),
});
if (createRes.ok) {
  console.log(`✅ created dev branch`);
} else if (createRes.status === 422) {
  console.log(`dev branch already exists — ok`);
} else {
  console.error(`create dev HTTP ${createRes.status}: ${await createRes.text()}`);
  process.exit(1);
}

// Verify
const dRes = await fetch(`https://api.github.com/repos/${REPO}/branches/dev`, { headers: H });
console.log(`verify dev: HTTP ${dRes.status} ${dRes.ok ? "✓" : ""}`);
