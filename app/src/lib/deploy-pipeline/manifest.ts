import "server-only";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface ManifestEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface PipelineManifest {
  generatedAt: string;
  repoRootSha: string | null;
  labelsCount: number;
  varsCount: number;
  files: ManifestEntry[];
}

const TEMPLATE_ROOT = resolve(process.cwd(), "resources", "pipeline-template");
const MANIFEST_PATH = join(TEMPLATE_ROOT, "manifest.json");

let cachedManifest: PipelineManifest | null = null;

/**
 * Load the packaged pipeline manifest. Memoized — safe to call per-request.
 * Throws if the template has not been packaged yet (run `pnpm pack:pipeline`).
 */
export async function loadManifest(): Promise<PipelineManifest> {
  if (cachedManifest) return cachedManifest;
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    cachedManifest = JSON.parse(raw) as PipelineManifest;
    return cachedManifest;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `pipeline template manifest missing at ${MANIFEST_PATH}. ` +
        `Run \`pnpm pack:pipeline\` first. Underlying: ${msg}`,
    );
  }
}

/** Read a single packaged file's bytes. */
export async function readTemplateFile(
  entry: ManifestEntry,
): Promise<Uint8Array> {
  return await readFile(join(TEMPLATE_ROOT, entry.path));
}

/** Read a single packaged file's text (UTF-8). */
export async function readTemplateFileText(
  entry: ManifestEntry,
): Promise<string> {
  return await readFile(join(TEMPLATE_ROOT, entry.path), "utf8");
}

export const TEMPLATE_ROOT_PATH = TEMPLATE_ROOT;
