import "server-only";
import { createHash } from "node:crypto";
import { loadManifest, readTemplateFileText } from "./manifest";
import type { LabelDiff, RepoRef } from "./types";

const API = "https://api.github.com";

export interface LabelDef {
  name: string;
  color: string;
  description?: string;
}

/**
 * Parse .github/labels.yml into LabelDef[].
 *
 * Labels file format (matches github-labeler convention):
 *   - name: triage
 *     color: abc123
 *     description: Module 2 — incoming issue intake
 *   - name: ...
 *
 * Color may or may not have leading `#` — we normalise to bare hex
 * because GitHub Label API rejects the `#` prefix.
 */
export async function loadLabelDefs(): Promise<LabelDef[]> {
  const manifest = await loadManifest();
  const entry = manifest.files.find((f) => f.path === ".github/labels.yml");
  if (!entry) return [];
  const text = await readTemplateFileText(entry);
  return parseLabelsYml(text);
}

export function parseLabelsYml(text: string): LabelDef[] {
  const defs: LabelDef[] = [];
  let cur: Partial<LabelDef> | null = null;
  for (const line of text.split("\n")) {
    const m = /^\s*-\s*name:\s*(.+?)\s*$/.exec(line);
    if (m) {
      if (cur?.name) defs.push(cur as LabelDef);
      cur = { name: m[1] };
      continue;
    }
    if (cur) {
      const cm = /^\s*color:\s*(.+?)\s*$/.exec(line);
      if (cm) {
        cur.color = normalizeColor(cm[1]);
        continue;
      }
      const dm = /^\s*description:\s*(.+?)\s*$/.exec(line);
      if (dm) {
        cur.description = stripQuotes(dm[1]);
        continue;
      }
    }
  }
  if (cur?.name && cur.color) defs.push(cur as LabelDef);
  return defs;
}

function normalizeColor(raw: string): string {
  return stripQuotes(raw).replace(/^#/, "").trim();
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]/, "").replace(/['"]$/, "");
}

export async function listRemoteLabels(
  repo: RepoRef,
  token: string,
): Promise<Map<string, { color: string; description: string | null }>> {
  const map = new Map<string, { color: string; description: string | null }>();
  let page = 1;
  while (true) {
    const url = `${API}/repos/${repo.owner}/${repo.repo}/labels?per_page=100&page=${page}`;
    const res = await fetch(url, { headers: gh(token) });
    if (!res.ok) {
      throw new Error(`listRemoteLabels HTTP ${res.status}`);
    }
    const data = (await res.json()) as { name: string; color: string; description: string | null }[];
    for (const lbl of data) {
      map.set(lbl.name, { color: lbl.color, description: lbl.description });
    }
    if (data.length < 100) break;
    page += 1;
    if (page > 20) break;
  }
  return map;
}

export function diffLabels(
  defs: LabelDef[],
  remote: Map<string, { color: string; description: string | null }>,
): LabelDiff[] {
  const out: LabelDiff[] = [];
  for (const def of defs) {
    const r = remote.get(def.name);
    if (!r) {
      out.push({ ...def, status: "new" });
    } else if (
      r.color.toLowerCase() === def.color.toLowerCase() &&
      (r.description ?? "") === (def.description ?? "")
    ) {
      out.push({ ...def, status: "exists-same", remoteColor: r.color, remoteDescription: r.description ?? undefined });
    } else {
      out.push({ ...def, status: "exists-different", remoteColor: r.color, remoteDescription: r.description ?? undefined });
    }
  }
  return out;
}

export async function upsertLabel(
  repo: RepoRef,
  def: LabelDef,
  token: string,
): Promise<{ outcome: "created" | "updated"; message?: string } | { outcome: "failed"; message: string }> {
  const body = {
    name: def.name,
    color: def.color,
    description: def.description ?? "",
  };
  const createRes = await fetch(`${API}/repos/${repo.owner}/${repo.repo}/labels`, {
    method: "POST",
    headers: gh(token),
    body: JSON.stringify(body),
  });
  if (createRes.status === 201) {
    return { outcome: "created" };
  }
  if (createRes.status === 422) {
    // Label exists — fall through to PATCH
    const patchRes = await fetch(
      `${API}/repos/${repo.owner}/${repo.repo}/labels/${encodeURIComponent(def.name)}`,
      {
        method: "PATCH",
        headers: gh(token),
        body: JSON.stringify({
          new_name: def.name,
          color: def.color,
          description: def.description ?? "",
        }),
      },
    );
    if (patchRes.ok) return { outcome: "updated" };
    return { outcome: "failed", message: `PATCH HTTP ${patchRes.status}: ${(await safeText(patchRes)).slice(0, 160)}` };
  }
  return {
    outcome: "failed",
    message: `POST HTTP ${createRes.status}: ${(await safeText(createRes)).slice(0, 160)}`,
  };
}

function gh(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "GithubAutoDev-DeployWizard",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/** Helpful for tests/CI: hash a label def for change detection. */
export function labelFingerprint(def: LabelDef): string {
  return createHash("sha256")
    .update(`${def.name}|${def.color.toLowerCase()}|${def.description ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}
