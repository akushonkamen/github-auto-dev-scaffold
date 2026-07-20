"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

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
  repoFullName: string;
}

const STAGES = [
  "triage",
  "clarify",
  "design",
  "develop",
  "verify",
  "test",
  "pr-open",
  "review",
  "merge",
] as const;

/**
 * Subscribes to /api/runs/[runId]/events and re-renders the header as
 * snapshots arrive. The detail page is server-rendered once; this client
 * component keeps the live cells (status, currentStage) fresh.
 */
export function RunDetailHeader({ run: initial, fmtDate, repoFullName }: Props) {
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
      // Browser will auto-reconnect.
    });
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id, initial.status]);

  const stageIdx = run.currentStage ? STAGES.indexOf(run.currentStage as (typeof STAGES)[number]) : -1;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-xl">
              Run #{run.id}{" "}
              <span className="text-muted-foreground">·</span>{" "}
              <span className="font-mono text-base text-muted-foreground">
                Issue #{run.issueNumber}
              </span>
            </CardTitle>
            <CardDescription className="flex items-center gap-2">
              {live && (
                <Badge variant="info" className="gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                  实时
                </Badge>
              )}
              <span className="font-mono">{repoFullName}</span>
            </CardDescription>
          </div>
          {run.prNumber != null && (
            <Button asChild size="sm" variant="outline">
              <a
                href={`https://github.com/${repoFullName}/pull/${run.prNumber}`}
                target="_blank"
                rel="noreferrer"
              >
                打开 PR #{run.prNumber}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {[
            ["当前阶段", run.currentStage ?? "—", true],
            ["状态", run.status ?? "—", true],
            ["PR", run.prNumber != null ? `#${run.prNumber}` : "—", false],
            ["AI Tokens", run.aiTokensUsed?.toLocaleString() ?? "—", true],
            ["AI 分钟", run.aiMinutesUsed?.toFixed(2) ?? "—", true],
            ["开始", fmtDate(run.startedAt), false],
            ["完成", fmtDate(run.completedAt), false],
          ].map(([label, value, mono]) => (
            <div key={label as string} className="space-y-0.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {label}
              </div>
              <div className={cn("text-sm", mono && "font-mono")}>{value}</div>
            </div>
          ))}
        </div>

        <Separator className="my-4" />

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">阶段时间线</div>
          <div className="flex flex-wrap gap-1">
            {STAGES.map((s, i) => {
              const done = stageIdx >= 0 && i < stageIdx;
              const active = stageIdx === i;
              return (
                <span
                  key={s}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-mono",
                    done
                      ? "border-success/30 bg-success/10 text-success"
                      : active
                        ? "border-info/40 bg-info/10 text-info"
                        : "border-border text-muted-foreground",
                  )}
                >
                  {done && <Check className="h-3 w-3" />}
                  {active && (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
                  )}
                  {s}
                </span>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
