"use client";

import { cn } from "@/lib/utils";

export type StationStatus = "done" | "now" | "pending";

export interface Station {
  id: string;
  label: string;
  description?: string;
  tag?: string;
  status: StationStatus;
}

interface Props {
  stations: Station[];
  variant?: "horizontal" | "vertical";
  className?: string;
}

/**
 * 地铁式进度轨。
 * - horizontal：水平点+连接条（runs 详情页用）
 * - vertical：纵向 dot+bar 左列、name+tag+desc 右列（vibecoding 造物页用，
 *   严格复刻 autodev-frontend-design.html 的 .station 网格）
 *
 * 配色：done=work 青；now=you 琥珀 + 脉冲环；pending=border 灰。
 */
export function BuildRail({ stations, variant = "horizontal", className }: Props) {
  if (variant === "vertical") {
    return (
      <div className={cn("flex flex-col", className)}>
        {stations.map((s) => (
          <div
            key={s.id}
            className="grid grid-cols-[26px_1fr] gap-x-3.5"
          >
            {/* 左列：dot + 连接 bar */}
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "relative z-[1] mt-[5px] h-3.5 w-3.5 rounded-full border-[3px] bg-background",
                  s.status === "done" && "border-work bg-work",
                  s.status === "now" && "border-you bg-you",
                  s.status === "pending" && "border-border",
                )}
              >
                {s.status === "now" && (
                  <span className="absolute inset-[-7px] rounded-full border-2 border-you animate-omc-pulse" />
                )}
              </span>
              <span
                className={cn(
                  "my-0 w-[3px] min-h-[34px] flex-1",
                  s.status === "done" ? "bg-work" : "bg-border",
                )}
              />
            </div>

            {/* 右列：name + tag + desc */}
            <div className="pb-1.5 pt-0.5">
              <div
                className={cn(
                  "flex items-center gap-2 text-sm font-bold leading-tight",
                  s.status === "now" && "text-you",
                  s.status === "done" && "text-foreground",
                  s.status === "pending" && "font-medium text-muted-foreground",
                )}
              >
                {s.label}
                {s.tag && (
                  <span
                    className={cn(
                      "rounded font-mono text-[10px] px-1.5 py-px",
                      s.status === "now"
                        ? "bg-you-soft text-you"
                        : "bg-muted/60 text-muted-foreground",
                    )}
                  >
                    {s.tag}
                  </span>
                )}
              </div>
              {s.description && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {s.description}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // horizontal
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
                  s.status === "done" && "border-work bg-work",
                  s.status === "now" && "border-you bg-you-soft",
                  s.status === "pending" && "border-border bg-background",
                )}
              >
                {s.status === "now" && (
                  <span className="absolute inset-0 rounded-full bg-you/40 animate-omc-pulse" />
                )}
              </span>
              <span className="whitespace-nowrap text-[11px] font-medium">
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
