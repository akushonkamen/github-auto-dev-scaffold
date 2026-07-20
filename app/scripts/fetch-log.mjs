#!/usr/bin/env node
// Fetch failing job's log for a given run.
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

const REPO = "akushonkamen/gitautodev-deploy-smoke-1784474393";
const INSTALLATION_ID = 147710739;

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

// Get the failing job id — use latest triage-issue run unless runId passed
let runId = process.argv[2];
if (!runId) {
  const rR = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=10`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  const rD = await rR.json();
  const found = (rD.workflow_runs ?? []).find((r) => r.name === "triage-issue");
  if (!found) { console.error("no triage run found"); process.exit(1); }
  runId = found.id;
}
console.log(`Inspecting run ${runId}`);

const jobsRes = await fetch(`https://api.github.com/repos/${REPO}/actions/runs/${runId}/jobs`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
});
const jobs = await jobsRes.json();
const failingJob = jobs.jobs.find((j) => j.conclusion === "failure");
if (!failingJob) {
  console.error("no failing job found");
  process.exit(1);
}
console.log(`Failing job: ${failingJob.name} (id=${failingJob.id})`);

const logRes = await fetch(`https://api.github.com/repos/${REPO}/actions/jobs/${failingJob.id}/logs`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  redirect: "follow",
});
if (!logRes.ok) {
  console.error(`log fetch HTTP ${logRes.status}`);
  process.exit(1);
}
const logText = await logRes.text();

// Find the failing step's log section
const stepMatch = logText.match(/\[4 Run triage[\s\S]*?(?=\[\d+ |$)/);
const section = stepMatch ? stepMatch[0] : logText;

// Strip ANSI + filter to lines mentioning common failure causes
const clean = section.replace(/\x1b\[[0-9;]*m/g, "");
const lines = clean.split("\n");
const hot = lines.filter((l) =>
  /error|fail|404|401|403|429|500|invalid|not found|model|api[_-]?key|exception|traceback|timeout|unauthor/i.test(l)
);
console.log(`\n--- relevant lines (${hot.length}) ---`);
for (const l of hot.slice(-40)) console.log(l.slice(0, 400));
console.log(`\n--- last 30 lines of failing step ---`);
for (const l of lines.slice(-30)) console.log(l.slice(0, 400));
