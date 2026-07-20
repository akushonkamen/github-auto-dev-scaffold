import "server-only";

import type { RepoRef } from "./types";

const API = "https://api.github.com";

export interface PutFileArgs {
  repo: RepoRef;
  path: string;
  /** Raw bytes of the file content. Will be base64-encoded. */
  content: Uint8Array;
  commitMessage: string;
  /** When provided, update the existing file at this SHA. When omitted, create-only. */
  sha?: string;
  token: string;
}

export interface PutFileResult {
  status: "created" | "updated" | "skipped-conflict" | "failed";
  sha?: string;
  message?: string;
}

/** GitHub Contents API wrapper. Create-or-update single file. */
export async function putFile(args: PutFileArgs): Promise<PutFileResult> {
  const url = `${API}/repos/${args.repo.owner}/${args.repo.repo}/contents/${encodePath(args.path)}`;
  const body: Record<string, unknown> = {
    message: args.commitMessage,
    content: toBase64(args.content),
    branch: args.repo.defaultBranch,
  };
  if (args.sha) body.sha = args.sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: ghHeaders(args.token),
    body: JSON.stringify(body),
  });

  if (res.status === 201) {
    const data = (await res.json()) as { content?: { sha?: string } };
    return { status: "created", sha: data.content?.sha };
  }
  if (res.status === 200) {
    const data = (await res.json()) as { content?: { sha?: string } };
    return { status: "updated", sha: data.content?.sha };
  }
  if (res.status === 409) {
    return { status: "skipped-conflict", message: "file exists, no sha provided" };
  }
  const text = await safeText(res);
  return { status: "failed", message: `HTTP ${res.status}: ${text.slice(0, 200)}` };
}

export interface RemoteFileMeta {
  path: string;
  sha: string;
  size: number;
}

/** Recursive tree listing for the default branch. */
export async function listRepoFiles(
  repo: RepoRef,
  token: string,
): Promise<Map<string, RemoteFileMeta>> {
  const map = new Map<string, RemoteFileMeta>();
  const url = `${API}/repos/${repo.owner}/${repo.repo}/git/trees/${repo.defaultBranch}?recursive=1`;
  const res = await fetch(url, { headers: ghHeaders(token) });
  if (!res.ok) {
    if (res.status === 409 && /empty/i.test(await safeText(res))) return map;
    if (res.status === 404) return map;
    throw new Error(`listRepoFiles HTTP ${res.status}: ${(await safeText(res)).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    tree?: { path: string; sha: string; size?: number; type: string }[];
  };
  for (const entry of data.tree ?? []) {
    if (entry.type === "blob") {
      map.set(entry.path, { path: entry.path, sha: entry.sha, size: entry.size ?? 0 });
    }
  }
  return map;
}

/** Fetch a single file from the repo to compute its sha256. Returns null on 404. */
export async function fetchFileBytes(
  repo: RepoRef,
  path: string,
  token: string,
): Promise<{ sha: string; bytes: Uint8Array } | null> {
  const url = `${API}/repos/${repo.owner}/${repo.repo}/contents/${encodePath(path)}?ref=${repo.defaultBranch}`;
  const res = await fetch(url, { headers: ghHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`fetchFileBytes(${path}) HTTP ${res.status}`);
  }
  const data = (await res.json()) as { sha: string; content: string; encoding: string };
  if (data.encoding !== "base64") {
    throw new Error(`unexpected encoding ${data.encoding} for ${path}`);
  }
  const bytes = fromBase64(data.content);
  return { sha: data.sha, bytes };
}

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "GithubAutoDev-DeployWizard",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

function toBase64(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  return buf.toString("base64");
}

function fromBase64(s: string): Uint8Array {
  // GitHub strips newlines from base64 — re-pad before decoding
  const cleaned = s.replace(/\n/g, "");
  return new Uint8Array(Buffer.from(cleaned, "base64"));
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
