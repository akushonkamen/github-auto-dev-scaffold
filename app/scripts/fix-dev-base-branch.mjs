#!/usr/bin/env node
// Fix DEV_BASE_BRANCH on smoke repo to match its default branch (main).
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

// Installations can't write Actions Variables. Use the user PAT from env
// (CLAUDE_DEV_PAT set locally during earlier setup).
const pat = process.env.HOTFIX_PAT;
if (!pat) {
  console.error("Set HOTFIX_PAT env (fine-grained PAT with actions:write on the smoke repo).");
  process.exit(1);
}
const HP = { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

// Update DEV_BASE_BRANCH to main
const res = await fetch(`https://api.github.com/repos/${REPO}/actions/variables/DEV_BASE_BRANCH`, {
  method: "PATCH",
  headers: HP,
  body: JSON.stringify({ name: "DEV_BASE_BRANCH", value: "main" }),
});
console.log(`PATCH DEV_BASE_BRANCH=main: ${res.status} ${res.ok ? "✓" : await res.text()}`);

// Verify
const vRes = await fetch(`https://api.github.com/repos/${REPO}/actions/variables/DEV_BASE_BRANCH`, { headers: HP });
const v = await vRes.json();
console.log(`verify: ${JSON.stringify(v)}`);

// Reopen / retrigger by labeling accepted-by-claude on Issue #10 — but
// it's already labeled, and develop-gate runs on workflow_run. Re-trigger
// by creating a fresh test Issue instead.
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const iRes = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
  method: "POST",
  headers: HP,
  body: JSON.stringify({
    title: `[smoke] dev-base=main retry ${ts}`,
    body: "```\nclass: trivial\n```\nRetrying after DEV_BASE_BRANCH fix.",
  }),
});
const i = await iRes.json();
console.log(`\n✅ Issue #${i.number}: ${i.html_url}`);

console.log("Waiting 90s for triage + develop-gate...");
await new Promise((r) => setTimeout(r, 90000));

// Poll latest triage + develop-gate runs
for (let i = 0; i < 12; i++) {
  const rR = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=15`, { headers: H });
  const data = await rR.json();
  const triage = data.workflow_runs?.find((r) => r.name === "triage-issue");
  const dev = data.workflow_runs?.find((r) => r.name === "develop-gate" || r.name === "code-generate");
  console.log(`  poll ${i+1}: triage=${triage?.status ?? "-"}/${triage?.conclusion ?? "-"} develop=${dev?.name ?? "-"} ${dev?.status ?? "-"}/${dev?.conclusion ?? "-"}`);
  if (dev?.status === "completed") {
    const cRes = await fetch(`https://api.github.com/repos/${REPO}/issues/${i.number}/comments`, { headers: H });
    const cs = await cRes.json();
    console.log(`\n=== Issue #${i.number} comments (${cs.length}) ===`);
    for (const c of cs) console.log(`  @${c.user?.login}: ${c.body?.slice(0, 300)}`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 20000));
}
