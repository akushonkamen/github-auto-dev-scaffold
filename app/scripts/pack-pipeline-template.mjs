#!/usr/bin/env node
// Pack pipeline template from repo root .github/ + CLAUDE.md into
// app/resources/pipeline-template/ for the dashboard Deploy wizard.
//
// Run via `pnpm pack:pipeline`. Idempotent — safe to run repeatedly.
// app/resources/pipeline-template/ is gitignored; CI must run this before build.

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile, readdir, stat, rm } from "node:fs/promises";
import { join, relative, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const REPO_ROOT = normalize(join(__dirname, "..", ".."));
const SRC_DIR_GITHUB = join(REPO_ROOT, ".github");
const SRC_FILE_CLAUDE = join(REPO_ROOT, "CLAUDE.md");
const DEST_DIR = join(__dirname, "..", "resources", "pipeline-template");

// Whitelist rules. Anything not matched here is skipped silently.
const INCLUDE_RULES = [
  // Top-level single files
  { type: "file", path: "labels.yml" },
  { type: "file", path: "dependabot.yml" },
  { type: "file", path: "CODEOWNERS" },
  // Whole dirs (recursive, will be filtered)
  { type: "dir", path: "ISSUE_TEMPLATE" },
  { type: "dir", path: "workflows", filter: filterWorkflowFile },
  { type: "dir", path: "actions", filter: filterActionPath },
];

const EXCLUDE_PATH_FRAGMENTS = [
  "/.omc/",           // runtime state anywhere
  "/.verify-state.json",
];

function filterWorkflowFile(relPath) {
  const name = relPath.split("/").pop() ?? "";
  // Optional integrations — not deployed by default
  if (/^feishu-/i.test(name)) return false;
  if (/^notion-/i.test(name)) return false;
  return true;
}

function filterActionPath(relPath) {
  // Skip optional integration actions
  if (relPath.startsWith("feishu-sync/")) return false;
  if (relPath.startsWith("notion-sync/")) return false;
  return true;
}

function shouldExcludeByFragment(absPath) {
  return EXCLUDE_PATH_FRAGMENTS.some((frag) => absPath.includes(frag));
}

async function walkDir(absDir, filter, acc = []) {
  const entries = await readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".omc") continue;
      await walkDir(abs, filter, acc);
    } else if (entry.isFile()) {
      if (shouldExcludeByFragment(abs)) continue;
      const relFromRoot = relative(SRC_DIR_GITHUB, abs);
      if (filter && !filter(relFromRoot)) continue;
      acc.push(abs);
    }
  }
  return acc;
}

async function collectFiles() {
  const files = [];

  for (const rule of INCLUDE_RULES) {
    const src = join(SRC_DIR_GITHUB, rule.path);
    let st;
    try {
      st = await stat(src);
    } catch {
      // skip missing
      continue;
    }
    if (rule.type === "file" && st.isFile()) {
      files.push({ abs: src, rel: rule.path });
    } else if (rule.type === "dir" && st.isDirectory()) {
      const absList = await walkDir(src, rule.filter);
      for (const abs of absList) {
        files.push({ abs, rel: relative(SRC_DIR_GITHUB, abs) });
      }
    }
  }

  // CLAUDE.md
  try {
    const st = await stat(SRC_FILE_CLAUDE);
    if (st.isFile()) {
      files.push({ abs: SRC_FILE_CLAUDE, rel: "../CLAUDE.md" });
    }
  } catch {
    // skip
  }

  return files;
}

async function main() {
  console.log(`[pack-pipeline-template] src=${SRC_DIR_GITHUB}`);
  console.log(`[pack-pipeline-template] dest=${DEST_DIR}`);

  const files = await collectFiles();
  if (files.length === 0) {
    console.error("[pack-pipeline-template] no files collected — aborting");
    process.exit(1);
  }

  // Clean destination
  await rm(DEST_DIR, { recursive: true, force: true });
  await mkdir(DEST_DIR, { recursive: true });

  const manifestEntries = [];

  for (const { abs, rel } of files) {
    const content = await readFile(abs);
    // Normalise rel path:
    //  - .github/* stays as-is under .github/
    //  - CLAUDE.md → top-level
    const normalizedRel = rel === "../CLAUDE.md" ? "CLAUDE.md" : `.github/${rel}`;
    const dest = join(DEST_DIR, normalizedRel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content);

    const sha256 = createHash("sha256").update(content).digest("hex");
    manifestEntries.push({
      path: normalizedRel,
      size: content.length,
      sha256,
    });
  }

  // Load labels count for informational field
  let labelsCount = 0;
  try {
    const labelsContent = await readFile(join(SRC_DIR_GITHUB, "labels.yml"), "utf8");
    labelsCount = labelsContent.split("\n").filter((l) => /^\s*-\s*name:/.test(l)).length;
  } catch {
    // ignore
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    repoRootSha: null,
    labelsCount,
    varsCount: 24,
    files: manifestEntries.sort((a, b) => a.path.localeCompare(b.path)),
  };

  await writeFile(join(DEST_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

  // version.txt — read by checkUpgradeNeeded() to compare against
  // installations.pipeline_version. PIPELINE_VERSION env var overrides;
  // default v0.1.0 keeps the bundle self-describing when the var is unset.
  const pipelineVersion = process.env.PIPELINE_VERSION ?? "v0.1.0";
  await writeFile(join(DEST_DIR, "version.txt"), pipelineVersion, "utf8");

  console.log(`[pack-pipeline-template] OK: ${manifestEntries.length} files, ${labelsCount} labels, version=${pipelineVersion}`);
}

main().catch((err) => {
  console.error("[pack-pipeline-template] FAIL", err);
  process.exit(1);
});
