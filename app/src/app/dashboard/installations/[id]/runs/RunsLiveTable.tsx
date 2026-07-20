"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

const TERMINAL = new Set(["dispatched", "failed"]);

function statusVariant(status: string | null) {
  if (!status) return { variant: "secondary" as const };
  if (status === "merged") return { variant: "success" as const };
  if (status === "failed") return { variant: "destructive" as const };
  if (status === "running" || status === "in-review")
    return { variant: "info" as const };
  if (status === "queued" || status === "dispatched")
    return { variant: "warning" as const };
  return { variant: "secondary" as const };
}

/**
 * Hydrates with server-rendered rows, then opens one EventSource per active
 * (non-terminal) run to update its status cell in place. Capped at the first
 * 10 active runs to avoid opening 50 connections.
 */
export function RunsLiveTable({ initialRuns, fmtDate, installationDbId }: Props) {
  const [rows, setRows] = useState<RunRowJson[]>(initialRuns);
  const [now, setNow] = useState(() => Date.now());

  const activeIds = useMemo(() => {
    return rows
      .filter((r) => r.status && !TERMINAL.has(r.status))
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
        // SSE auto-reconnect handles this; if it gives up, we just stop
        // getting updates — acceptable for v1.
      });
    }
    return () => {
      streams.forEach((s) => s.close());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Issue</TableHead>
            <TableHead>当前阶段</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="text-right">AI Tokens</TableHead>
            <TableHead>开始</TableHead>
            <TableHead>PR</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const live = r.status != null && !TERMINAL.has(r.status);
            const v = statusVariant(r.status);
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    href={`/dashboard/installations/${installationDbId}/runs/${r.id}`}
                    className="font-mono text-primary underline underline-offset-2"
                  >
                    #{r.issueNumber}
                  </Link>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs">
                    {r.currentStage ?? "—"}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={v.variant} className="gap-1.5">
                    {live && (
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                    )}
                    {r.status ?? "—"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {r.aiTokensUsed?.toLocaleString() ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {fmtDate(r.startedAt)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {r.prNumber != null ? `#${r.prNumber}` : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
        实时刷新依赖 EventSource；前 10 条未结束的 run 自动刷新。检查时刻：{new Date(now).toISOString()}
      </div>
    </>
  );
}
