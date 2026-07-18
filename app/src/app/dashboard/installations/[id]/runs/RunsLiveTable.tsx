"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export interface RunRowJson {
  id: number;
  issueNumber: number;
  prNumber: number | null;
  currentStage: string | null;
  status: string | null;
  aiTokensUsed: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface Props {
  initialRuns: RunRowJson[];
  fmtDate: (value: Date | string | null) => string;
  installationDbId: number;
}

/**
 * Client component that hydrates with server-rendered rows and then opens
 * one EventSource per active (non-terminal) run to update its status cell
 * in place. EventSource is the lightest transport that still respects the
 * user's session cookie — no WebSocket upgrade needed.
 *
 * We cap at the first 10 active runs to avoid opening 50 connections when
 * the list is long; the rest will refresh on next page load.
 */
export function RunsLiveTable({ initialRuns, fmtDate, installationDbId }: Props) {
  const [rows, setRows] = useState<RunRowJson[]>(initialRuns);
  const [now, setNow] = useState(() => Date.now());

  // Track which run ids are active (non-terminal) so we can subscribe.
  const activeIds = useMemo(() => {
    const TERMINAL = new Set(["dispatched", "failed"]);
    return rows.filter((r) => r.status && !TERMINAL.has(r.status))
      .slice(0, 10)
      .map((r) => r.id);
  }, [rows]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(tick);
  }, []);

  const activeKey = activeIds.join(",");
  useEffect(() => {
    if (!activeIds.length) return;
    const streams: EventSource[] = [];
    for (const runId of activeIds) {
      const es = new EventSource(`/api/runs/${runId}/events`, {
        withCredentials: true,
      });
      streams.push(es);
      es.addEventListener("snapshot", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as RunRowJson;
          setRows((prev) =>
            prev.map((r) => (r.id === data.id ? { ...r, ...data } : r)),
          );
        } catch {
          // ignore malformed payloads
        }
      });
      es.addEventListener("complete", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as RunRowJson;
          setRows((prev) =>
            prev.map((r) => (r.id === data.id ? { ...r, ...data } : r)),
          );
        } catch {
          // ignore
        }
        es.close();
      });
      es.addEventListener("error", () => {
        // SSE auto-reconnect will retry; if it gives up, we'll just stop
        // getting updates — acceptable for v1.
      });
    }
    return () => {
      streams.forEach((s) => s.close());
    };
    // Re-subscribe when the set of active run ids changes. We intentionally
    // depend on the joined key, not the array identity, so the effect re-runs
    // only when membership changes — not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th className="py-2 pr-4">Issue</th>
          <th className="py-2 pr-4">当前阶段</th>
          <th className="py-2 pr-4">状态</th>
          <th className="py-2 pr-4">AI Tokens</th>
          <th className="py-2 pr-4">开始</th>
          <th className="py-2 pr-4">PR</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const isActive = r.status && !["dispatched", "failed"].includes(r.status);
          return (
            <tr key={r.id} className={"border-t hover:bg-accent/30"}>
              <td className="py-2 pr-4">
                <Link
                  href={`/dashboard/installations/${installationDbId}/runs/${r.id}`}
                  className="text-primary underline underline-offset-2"
                >
                  #{r.issueNumber}
                </Link>
              </td>
              <td className="py-2 pr-4 font-mono">{r.currentStage ?? "—"}</td>
              <td className="py-2 pr-4 font-mono">
                {r.status ?? "—"}
                {isActive && (
                  <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                )}
              </td>
              <td className="py-2 pr-4">{r.aiTokensUsed ?? "—"}</td>
              <td className="py-2 pr-4">{fmtDate(r.startedAt)}</td>
              <td className="py-2 pr-4">{r.prNumber ?? "—"}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="text-xs text-muted-foreground">
          <td colSpan={6} className="py-2">
            实时刷新依赖 EventSource；前 10 条未结束的 run 会自动刷新。刷新时间：{new Date(now).toISOString()}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
