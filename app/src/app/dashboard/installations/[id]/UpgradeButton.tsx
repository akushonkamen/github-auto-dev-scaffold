"use client";

import { useState } from "react";

interface Props {
  dbId: number;
  latest: string;
}

/**
 * Client-side button for the pipeline-version upgrade banner. Posts to
 * /api/installations/[id]/upgrade-pipeline. Prompts for the LLM API key
 * + optional PAT before sending — same params as the Deploy wizard.
 *
 * Why client: the banner lives in a server component, but the click needs
 * `fetch()` + form state. Keeping this isolated lets the rest of the page
 * stay server-rendered.
 */
export function UpgradeButton({ dbId, latest }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      llmKey: String(fd.get("llmKey") ?? ""),
      claudePat: String(fd.get("claudePat") ?? "") || undefined,
      claudePatOwner: String(fd.get("claudePatOwner") ?? "") || undefined,
      baseBranch: String(fd.get("baseBranch") ?? "") || undefined,
    };
    try {
      const res = await fetch(`/api/installations/${dbId}/upgrade-pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; newVersion?: string };
      if (!res.ok || !json.ok) {
        setErr(json.error ?? `HTTP ${res.status}`);
      } else {
        setDone(json.newVersion ?? latest);
        setShowForm(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-primary">
        ✓ Upgraded to {done}. Re-deploy required for next pipeline run.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {!showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90"
        >
          Upgrade to {latest}
        </button>
      )}
      {showForm && (
        <form onSubmit={onSubmit} className="space-y-2 rounded-md border bg-background p-3">
          <label className="block text-xs">
            <span className="mb-1 block font-medium">LLM_API_KEY *</span>
            <input
              name="llmKey"
              type="password"
              required
              minLength={8}
              className="w-full rounded border bg-muted px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium">CLAUDE_DEV_PAT (optional)</span>
            <input
              name="claudePat"
              type="password"
              className="w-full rounded border bg-muted px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium">PAT owner (optional)</span>
            <input
              name="claudePatOwner"
              type="text"
              className="w-full rounded border bg-muted px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium">Base branch (optional)</span>
            <input
              name="baseBranch"
              type="text"
              defaultValue="main"
              className="w-full rounded border bg-muted px-2 py-1 text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "Upgrading…" : `Confirm upgrade to ${latest}`}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {err && <p className="text-sm text-destructive">✗ {err}</p>}
    </div>
  );
}
