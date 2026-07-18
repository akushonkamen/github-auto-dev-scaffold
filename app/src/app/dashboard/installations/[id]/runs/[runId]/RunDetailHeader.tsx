"use client";

import { useEffect, useState } from "react";

interface RunHeaderData {
  id: number;
  issueNumber: number;
  prNumber: number | null;
  currentStage: string | null;
  status: string | null;
  aiTokensUsed: number | null;
  aiMinutesUsed: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface Props {
  run: RunHeaderData;
  fmtDate: (value: Date | string | null) => string;
}

/**
 * Subscribes to /api/runs/[runId]/events and re-renders the header as
 * snapshots arrive. The detail page is server-rendered once; this client
 * component keeps the live cells (status, currentStage) fresh without
 * reloading.
 */
export function RunDetailHeader({ run: initial, fmtDate }: Props) {
  const [run, setRun] = useState(initial);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const TERMINAL = new Set(["dispatched", "failed"]);
    if (initial.status && TERMINAL.has(initial.status)) return;

    const es = new EventSource(`/api/runs/${initial.id}/events`, {
      withCredentials: true,
    });
    es.addEventListener("ready", () => setLive(true));
    es.addEventListener("snapshot", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as Partial<RunHeaderData>;
        setRun((prev) => ({ ...prev, ...data }));
      } catch {
        // ignore
      }
    });
    es.addEventListener("complete", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as Partial<RunHeaderData>;
        setRun((prev) => ({ ...prev, ...data }));
      } catch {
        // ignore
      }
      es.close();
      setLive(false);
    });
    es.addEventListener("error", () => {
      // Browser will auto-reconnect. If it gives up, setLive stays true —
      // cosmetic only.
    });
    return () => es.close();
    // Subscribe once on mount using the server-rendered snapshot. The
    // EventSource itself drives all subsequent state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id, initial.status]);

  return (
    <header className="w-full max-w-4xl space-y-2 rounded-lg border p-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Run #{run.id} (Issue #{run.issueNumber})</h1>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {live && (
            <>
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              实时
            </>
          )}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <Field label="当前阶段" value={run.currentStage ?? "—"} mono />
        <Field label="状态" value={run.status ?? "—"} mono />
        <Field label="PR" value={run.prNumber != null ? `#${run.prNumber}` : "—"} />
        <Field label="AI Tokens" value={run.aiTokensUsed?.toString() ?? "—"} />
        <Field label="AI Minutes" value={run.aiMinutesUsed?.toFixed(2) ?? "—"} />
        <Field label="开始" value={fmtDate(run.startedAt)} />
        <Field label="完成" value={fmtDate(run.completedAt)} />
      </div>
    </header>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  );
}
