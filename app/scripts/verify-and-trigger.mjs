#!/usr/bin/env node
// Verify DEV_BASE_BRANCH=main + trigger fresh Issue to test develop-gate.
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

// 1. Verify DEV_BASE_BRANCH via installation token (read works)
const vRes = await fetch(`https://api.github.com/repos/${REPO}/actions/variables/DEV_BASE_BRANCH`, { headers: H });
if (!vRes.ok) {
  console.error(`read var HTTP ${vRes.status} — install token can't read actions vars either`);
} else {
  const v = await vRes.json();
  console.log(`DEV_BASE_BRANCH = ${JSON.stringify(v)}`);
  if (v.value !== "main") {
    console.error(`⚠️ expected "main", got "${v.value}"`);
    process.exit(1);
  }
}

// 2. Trigger fresh Issue
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const iRes = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    title: `[smoke] dev-base=main retry ${ts}`,
    body: "```\nclass: trivial\n```\nRetrying full pipeline after DEV_BASE_BRANCH=main fix.",
  }),
});
const issue = await iRes.json();
console.log(`\n✅ Issue #${issue.number}: ${issue.html_url}`);

// 3. Poll until develop-gate / code-generate completes
console.log("Waiting 90s...");
await new Promise((r) => setTimeout(r, 90000));

for (let i = 0; i < 20; i++) {
  const rR = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=20`, { headers: H });
  const data = await rR.json();
  const runs = data.workflow_runs ?? [];
  const triage = runs.find((r) => r.name === "triage-issue");
  const develop = runs.find((r) => r.name === "develop-gate");
  const codegen = runs.find((r) => r.name === "code-generate");
  console.log(`  poll ${i+1}: triage=${triage?.conclusion ?? "-"} develop-gate=${develop?.status ?? "-"}${develop?.conclusion ? "/"+develop.conclusion : ""} code-generate=${codegen?.status ?? "-"}${codegen?.conclusion ? "/"+codegen.conclusion : ""}`);

  if (codegen?.status === "completed" || develop?.conclusion === "failure") {
    const cRes = await fetch(`https://api.github.com/repos/${REPO}/issues/${issue.number}/comments`, { headers: H });
    const cs = await cRes.json();
    console.log(`\n=== Issue #${issue.number} comments (${cs.length}) ===`);
    for (const c of cs) console.log(`\n  @${c.user?.login}:\n  ${c.body?.slice(0, 500)}`);

    const iRes2 = await fetch(`https://api.github.com/repos/${REPO}/issues/${issue.number}`, { headers: H });
    const i2 = await iRes2.json();
    console.log(`\nFinal labels: ${(i2.labels ?? []).map((l) => l.name).join(", ")}`);

    // Also look for PR
    const pRes = await fetch(`https://api.github.com/repos/${REPO}/issues/${issue.number}/timeline`, { headers: { ...H, Accept: "application/vnd.github.mockingbird-preview+json" } });
    if (pRes.ok) {
      const tl = await pRes.json();
      const prs = tl.filter((e) => e.event === "cross-referenced" && e.source?.issue?.pull_request);
      if (prs.length > 0) {
        console.log(`\nLinked PR:`);
        for (const p of prs) console.log(`  ${p.source.issue.pull_request.html_url}`);
      }
    }
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 20000));
}
console.error("Pipeline did not complete in polling window");
process.exit(3);
