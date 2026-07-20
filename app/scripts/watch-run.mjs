#!/usr/bin/env node
// Watch the most recent triage-issue run on the smoke repo, print jobs + logs.
//   pnpm exec node scripts/watch-run.mjs [run_id]
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
const RUN_ID = process.argv[2];

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
const H = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "GithubAutoDev-WatchRun",
};

// Resolve run id: use arg, or pick the most recent triage-issue run.
let runId = RUN_ID;
if (!runId) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=10`, { headers: H });
  const data = await r.json();
  const found = (data.workflow_runs ?? []).find((x) => x.name === "triage-issue");
  if (!found) {
    console.error("No triage-issue run found. Recent runs:");
    for (const x of data.workflow_runs ?? []) console.error(`  ${x.name} ${x.status}/${x.conclusion ?? "-"}`);
    process.exit(1);
  }
  runId = found.id;
}

const runRes = await fetch(`https://api.github.com/repos/${REPO}/actions/runs/${runId}`, { headers: H });
const run = await runRes.json();
console.log(`Run #${run.id}: ${run.name} → ${run.status}/${run.conclusion ?? "(running)"}`);
console.log(`  trigger: ${run.event}`);
console.log(`  created: ${run.created_at}`);
console.log(`  url: ${run.html_url}\n`);

const jobsRes = await fetch(`https://api.github.com/repos/${REPO}/actions/runs/${runId}/jobs`, { headers: H });
const jobsData = await jobsRes.json();
for (const job of jobsData.jobs ?? []) {
  console.log(`── job: ${job.name} [${job.status}/${job.conclusion ?? "-"}] ──`);
  for (const step of job.steps ?? []) {
    const mark = step.conclusion === "success" ? "✓" : step.conclusion === "failure" ? "✗" : "·";
    console.log(`  ${mark} ${step.number}. ${step.name} [${step.status}/${step.conclusion ?? "-"}]`);
  }
}

// If failed, fetch logs zip would require download. Instead, fetch annotations.
const annoRes = await fetch(`https://api.github.com/repos/${REPO}/check-runs/${runId}/annotations`, { headers: H });
if (annoRes.ok) {
  const annos = await annoRes.json();
  if (annos.length > 0) {
    console.log(`\n── annotations (${annos.length}) ──`);
    for (const a of annos) {
      console.log(`  [${a.level}] ${a.message?.slice(0, 300)}`);
    }
  }
}

// Also fetch issue comments to see if pipeline posted anything.
const issueNum = Number(run.display_title?.match(/#(\d+)/)?.[1] ?? 7);
const cRes = await fetch(`https://api.github.com/repos/${REPO}/issues/${issueNum}/comments`, { headers: H });
const cData = await cRes.json();
console.log(`\n── issue #${issueNum} comments (${cData.length ?? 0}) ──`);
for (const c of cData ?? []) {
  console.log(`\n  @${c.user?.login} said:\n  ${c.body?.slice(0, 500)}`);
}

// Also fetch issue labels
const iRes = await fetch(`https://api.github.com/repos/${REPO}/issues/${issueNum}`, { headers: H });
const iData = await iRes.json();
console.log(`\n── issue #${issueNum} labels ──`);
for (const l of iData.labels ?? []) console.log(`  - ${l.name}`);
