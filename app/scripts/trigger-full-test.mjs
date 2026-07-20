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

const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const iRes = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    title: `[smoke] full pipeline ${ts}`,
    body: "```\nclass: trivial\n```\nFull pipeline test with dev branch + DEV_BASE_BRANCH=dev.",
  }),
});
const issue = await iRes.json();
console.log(`✅ Issue #${issue.number}: ${issue.html_url}`);

console.log("Waiting 2 min for triage + develop...");
await new Promise((r) => setTimeout(r, 120000));

for (let i = 0; i < 25; i++) {
  const rR = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=25`, { headers: H });
  const data = await rR.json();
  const runs = data.workflow_runs ?? [];
  const latestTriage = runs.find((r) => r.name === "triage-issue");
  const latestCodegen = runs.find((r) => r.name === "code-generate");
  const latestPRLifecycle = runs.find((r) => r.name === "pr-lifecycle");
  const latestVerify = runs.find((r) => r.name === "verify");
  console.log(`  poll ${i+1}: triage=${latestTriage?.conclusion ?? "-"} codegen=${latestCodegen?.status ?? "-"}${latestCodegen?.conclusion ? "/"+latestCodegen.conclusion : ""} verify=${latestVerify?.status ?? "-"}${latestVerify?.conclusion ? "/"+latestVerify.conclusion : ""} pr-life=${latestPRLifecycle?.status ?? "-"}${latestPRLifecycle?.conclusion ? "/"+latestPRLifecycle.conclusion : ""}`);

  // Done when verify or PR lifecycle completes
  if (latestVerify?.status === "completed" || latestPRLifecycle?.status === "completed") {
    const cRes = await fetch(`https://api.github.com/repos/${REPO}/issues/${issue.number}/comments`, { headers: H });
    const cs = await cRes.json();
    console.log(`\n=== Issue #${issue.number} comments (${cs.length}) ===`);
    for (const c of cs) console.log(`\n  @${c.user?.login}:\n  ${c.body?.slice(0, 400)}`);

    const iFinal = await fetch(`https://api.github.com/repos/${REPO}/issues/${issue.number}`, { headers: H });
    const iF = await iFinal.json();
    console.log(`\nFinal labels: ${(iF.labels ?? []).map((l) => l.name).join(", ")}`);

    // Find linked PRs
    const pRes = await fetch(`https://api.github.com/repos/${REPO}/pulls?state=open`, { headers: H });
    const prs = await pRes.json();
    console.log(`\nOpen PRs (${prs.length}):`);
    for (const p of prs) console.log(`  #${p.number} ${p.title}  ${p.html_url}`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 20000));
}
