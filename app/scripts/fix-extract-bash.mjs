#!/usr/bin/env node
// Hotfix: deploy the `bash extract.sh` patch directly to main on the smoke
// repo (ruleset was deleted earlier so direct push works), then trigger a
// fresh test Issue to validate end-to-end triage.
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
const FILES = [
  ".github/actions/triage/action.yml",
  ".github/actions/develop/action.yml",
  ".github/actions/clarify/action.yml",
];

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
  "User-Agent": "GithubAutoDev-FixExtract",
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

// 1. Resolve default branch + latest commit sha
const repoRes = await api(`/repos/${REPO}`);
const defaultBranch = repoRes.json.default_branch;
const refRes = await api(`/repos/${REPO}/git/refs/heads/${defaultBranch}`);
const parentSha = refRes.json.object.sha;
console.log(`Base: ${defaultBranch}@${parentSha.slice(0,7)}`);

// 2. Make a fresh tree with all three patched files (preserves 100644 mode
//    but that's fine — we now invoke via `bash`, not direct exec).
const localFiles = [];
for (const path of FILES) {
  const content = await readFile(join(REPO_ROOT, path), "utf8");
  const blobRes = await api(`/repos/${REPO}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: Buffer.from(content).toString("base64"), encoding: "base64" }),
  });
  if (!blobRes.ok) { console.error(`blob ${path} HTTP ${blobRes.status}: ${blobRes.text}`); process.exit(1); }
  localFiles.push({ path, sha: blobRes.json.sha });
  console.log(`  blob: ${path} (${content.length}b)`);
}

const baseTreeRes = await api(`/repos/${REPO}/git/trees/${defaultBranch}?recursive=1`);
const baseTree = baseTreeRes.json;

const newTree = await api(`/repos/${REPO}/git/trees`, {
  method: "POST",
  body: JSON.stringify({
    base_tree: baseTree.sha,
    tree: localFiles.map((f) => ({
      path: f.path, mode: "100644", type: "blob", sha: f.sha,
    })),
  }),
});
if (!newTree.ok) { console.error(`tree HTTP ${newTree.status}: ${newTree.text}`); process.exit(1); }
console.log(`new tree: ${newTree.json.sha}`);

// 3. Commit on top of default branch head
const commitRes = await api(`/repos/${REPO}/git/commits`, {
  method: "POST",
  body: JSON.stringify({
    message: "fix(triage): invoke extract.sh via bash (Contents API strips +x)",
    tree: newTree.json.sha,
    parents: [parentSha],
  }),
});
if (!commitRes.ok) { console.error(`commit HTTP ${commitRes.status}: ${commitRes.text}`); process.exit(1); }
console.log(`commit: ${commitRes.json.sha}`);

// 4. Fast-forward branch ref
const ffRes = await api(`/repos/${REPO}/git/refs/heads/${defaultBranch}`, {
  method: "PATCH",
  body: JSON.stringify({ sha: commitRes.json.sha }),
});
if (!ffRes.ok) { console.error(`ref HTTP ${ffRes.status}: ${ffRes.text}`); process.exit(1); }
console.log(`✅ pushed to ${defaultBranch}`);

// 5. Create test Issue
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const issueRes = await api(`/repos/${REPO}/issues`, {
  method: "POST",
  body: JSON.stringify({
    title: `[smoke] triage bash-extract ${ts}`,
    body: "```\nclass: trivial\n```\nVerifying that the `bash extract.sh` patch fixes the parse failure.",
  }),
});
if (!issueRes.ok) { console.error(`issue HTTP ${issueRes.status}: ${issueRes.text}`); process.exit(1); }
console.log(`\n✅ Issue #${issueRes.json.number}: ${issueRes.json.html_url}`);

// 6. Poll triage workflow
console.log(`Waiting 30s...`);
await new Promise((r) => setTimeout(r, 30000));

for (let i = 0; i < 10; i++) {
  const rR = await api(`/repos/${REPO}/actions/runs?per_page=5`);
  const latest = rR.json.workflow_runs?.find((r) => r.name === "triage-issue");
  if (latest) {
    console.log(`  poll ${i+1}: ${latest.status}/${latest.conclusion ?? "-"}  ${latest.html_url}`);
    if (latest.status === "completed") {
      const fi = await api(`/repos/${REPO}/issues/${issueRes.json.number}`);
      console.log(`\n=== Final ===`);
      console.log(`Run: ${latest.conclusion}`);
      console.log(`Issue labels: ${(fi.json.labels ?? []).map((l) => l.name).join(", ") || "(none)"}`);
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
