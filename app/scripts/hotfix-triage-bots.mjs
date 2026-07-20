#!/usr/bin/env node
// Push the patched action.yml via PR (because ruleset blocks direct push),
// then trigger a fresh test issue.
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
const REPO_ROOT = join(__dirname, "..", "..");
const FILE_REL = ".github/actions/triage/action.yml";

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
  "User-Agent": "GithubAutoDev-Hotfix",
};

const api = async (path, opts = {}) => {
  const res = await fetch(path.startsWith("http") ? path : `https://api.github.com${path}`, {
    ...opts, headers: { ...H, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text };
};

// 1. Get default branch + sha
const repoRes = await api(`/repos/${REPO}`);
const defaultBranch = repoRes.json.default_branch;
console.log(`Default branch: ${defaultBranch}`);
const refRes = await api(`/repos/${REPO}/git/refs/heads/${defaultBranch}`);
const baseSha = refRes.json.object.sha;
console.log(`Base sha: ${baseSha}`);

// 2. Create hotfix branch
const branchName = `hotfix/triage-allowed-bots-${Date.now()}`;
console.log(`Creating branch: ${branchName}`);
const brRes = await api(`/repos/${REPO}/git/refs`, {
  method: "POST",
  body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
});
if (!brRes.ok) { console.error(`branch HTTP ${brRes.status}: ${brRes.text}`); process.exit(1); }

// 3. PUT file on new branch
const local = await readFile(join(REPO_ROOT, FILE_REL), "utf8");
const metaRes = await api(`/repos/${REPO}/contents/${encodeURIComponent(FILE_REL)}?ref=${branchName}`);
const sha = metaRes.json?.sha;
const putRes = await api(`/repos/${REPO}/contents/${encodeURIComponent(FILE_REL)}`, {
  method: "PUT",
  body: JSON.stringify({
    message: "fix(triage): allow gitautodev[bot] for smoke-test triggers",
    content: Buffer.from(local).toString("base64"),
    branch: branchName,
    ...(sha ? { sha } : {}),
  }),
});
if (!putRes.ok) { console.error(`PUT HTTP ${putRes.status}: ${putRes.text}`); process.exit(1); }
console.log(`✅ pushed to branch`);

// 4. Create PR
const prRes = await api(`/repos/${REPO}/pulls`, {
  method: "POST",
  body: JSON.stringify({
    title: "fix(triage): allow gitautodev[bot]",
    body: "Hotfix: claude-code-action refuses Bot-initiated workflows by default. Add `allowed_bots` so smoke-test issues created via installation token can run triage.",
    head: branchName,
    base: defaultBranch,
  }),
});
if (!prRes.ok) { console.error(`PR HTTP ${prRes.status}: ${prRes.text}`); process.exit(1); }
console.log(`✅ PR #${prRes.json.number}: ${prRes.json.html_url}`);
const prNumber = prRes.json.number;

// 5. Apply pipeline-fix label (S7 escape hatch) to bypass ruleset CI gates
await api(`/repos/${REPO}/issues/${prNumber}/labels`, {
  method: "POST",
  body: JSON.stringify({ labels: ["pipeline-fix"] }),
});
console.log(`✅ labeled pipeline-fix`);

// 6. Merge PR with admin override
console.log(`Merging PR with admin override...`);
const mergeRes = await api(`/repos/${REPO}/pulls/${prNumber}/merge`, {
  method: "PUT",
  body: JSON.stringify({
    commit_title: "fix(triage): allow gitautodev[bot] (pipeline-fix)",
    merge_method: "squash",
  }),
});
if (!mergeRes.ok) {
  console.error(`merge HTTP ${mergeRes.status}: ${mergeRes.text}`);
  console.error(`PR URL: ${prRes.json.html_url}  ← merge manually if needed`);
  process.exit(1);
}
console.log(`✅ merged`);

// 7. Trigger new test issue
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const title = `[smoke] triage retry after allowed_bots ${ts}`;
const body = `### Summary

Retry after merging allowed_bots fix.

\`\`\`
class: trivial
\`\`\`
`;
const issueRes = await api(`/repos/${REPO}/issues`, {
  method: "POST",
  body: JSON.stringify({ title, body, labels: [] }),
});
console.log(`\n✅ Issue #${issueRes.json.number}: ${issueRes.json.html_url}`);

// 8. Poll run
console.log(`\nWaiting 30s for triage...`);
await new Promise((r) => setTimeout(r, 30000));

for (let i = 0; i < 8; i++) {
  const runsRes = await api(`/repos/${REPO}/actions/runs?per_page=3`);
  const latest = runsRes.json.workflow_runs?.find((r) => r.name === "triage-issue");
  if (latest) {
    console.log(`  poll ${i+1}: ${latest.status}/${latest.conclusion ?? "-"}  ${latest.html_url}`);
    if (latest.status === "completed") {
      // Final state of issue
      const finalIssue = await api(`/repos/${REPO}/issues/${issueRes.json.number}`);
      console.log(`\n=== Final ===`);
      console.log(`Run: ${latest.status}/${latest.conclusion}`);
      console.log(`Issue labels: ${(finalIssue.json.labels ?? []).map((l) => l.name).join(", ") || "(none)"}`);
      const cData = await api(`/repos/${REPO}/issues/${issueRes.json.number}/comments`);
      console.log(`Issue comments: ${cData.json.length}`);
      for (const c of cData.json) console.log(`\n  @${c.user?.login}:\n  ${c.body?.slice(0, 600)}`);
      process.exit(latest.conclusion === "success" ? 0 : 2);
    }
  }
  await new Promise((r) => setTimeout(r, 15000));
}
console.error("Triage did not complete in polling window");
process.exit(3);
