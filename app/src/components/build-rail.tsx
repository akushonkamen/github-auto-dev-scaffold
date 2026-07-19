"use client";

import { cn } from "@/lib/utils";

export type StationStatus = "done" | "now" | "pending";

export interface Station {
  id: string;
  label: string;
  status: StationStatus;
}

interface Props {
  stations: Station[];
  className?: string;
}

/**
 * 地铁进度轨 — vibecoding 标志性视觉。
 * done：实心 work 圆点 + 勾；now：脉冲青色；pending：浅灰。
 * 站点之间用连接条，已走过的段着 work 色。
 */
export function BuildRail({ stations, className }: Props) {
  return (
    <div className={cn("flex items-center gap-0 overflow-x-auto", className)}>
      {stations.map((s, i) => {
        const next = stations[i + 1];
        const reached = s.status === "done" || s.status === "now";
        return (
          <div key={s.id} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5 px-2">
              <span
                className={cn(
                  "relative flex h-4 w-4 items-center justify-center rounded-full border",
                  s.status === "done" && "border-work bg-work text-work-foreground",
                  s.status === "now" && "border-work bg-work-soft",
                  s.status === "pending" && "border-border bg-background",
                )}
              >
                {s.status === "done" && (
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none">
                    <path
                      d="M2.5 6.5L5 9L9.5 3.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
                {s.status === "now" && (
                  <span className="absolute inset-0 rounded-full bg-work/50 motion-safe:animate-ping" />
                )}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-[11px] font-medium",
                  s.status === "pending" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {s.label}
              </span>
            </div>
            {next && (
              <span
                className={cn(
                  "h-px w-8 sm:w-12",
                  reached && next.status !== "pending" ? "bg-work" : "bg-border",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
