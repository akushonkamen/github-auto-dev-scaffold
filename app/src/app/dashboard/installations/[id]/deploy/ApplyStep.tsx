"use client";

import Link from "next/link";

import type { ApplyReport } from "@/lib/deploy-pipeline";

interface Props {
  running?: boolean;
  report?: ApplyReport;
  dbId?: number;
  error?: string | null;
}

export function ApplyStep({ running, report, dbId, error }: Props) {
  if (running) {
    return (
      <div className="rounded-md border p-6 text-center">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="mt-3 text-sm text-muted-foreground">
          正在部署（写文件 → labels → vars → secrets → ruleset）…请勿关闭页面。
        </p>
      </div>
    );
  }

  if (!report) {
    return null;
  }

  const c = report.counts;
  return (
    <div className="space-y-4">
      <section className="rounded-md border p-4">
        <h2 className="text-lg font-semibold">
          {report.ok ? "部署完成" : "部署完成（部分失败）"}
        </h2>
        <div className="mt-3 grid grid-cols-5 gap-2 text-sm">
          <Stat label="created" value={c.created} tone="info" />
          <Stat label="updated" value={c.updated} tone="info" />
          <Stat label="skipped" value={c.skipped} tone="muted" />
          <Stat label="unchanged" value={c.unchanged} tone="muted" />
          <Stat label="failed" value={c.failed} tone={c.failed > 0 ? "warn" : "muted"} />
        </div>
        {error && (
          <p className="mt-3 text-sm text-destructive break-all">{error}</p>
        )}
      </section>

      <section className="rounded-md border p-4 max-h-[28rem] overflow-auto">
        <h3 className="text-md font-semibold mb-2">详细</h3>
        <ul className="text-xs space-y-1 font-mono">
          {report.items.map((item, i) => (
            <li key={`${item.kind}-${item.key}-${i}`} className="flex items-baseline gap-2">
              <Icon outcome={item.outcome} />
              <span className="text-muted-foreground">[{item.kind}]</span>
              <span className="flex-1 break-all">{item.key}</span>
              <span className={
                item.outcome === "failed" ? "text-destructive"
                : item.outcome === "skipped" ? "text-muted-foreground"
                : item.outcome === "created" || item.outcome === "updated" ? "text-info"
                : "text-muted-foreground"
              }>
                {item.outcome}
              </span>
              {item.message && (
                <span className="text-muted-foreground truncate max-w-[40%]">{item.message}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {dbId !== undefined && (
        <div className="flex justify-end gap-2">
          <Link
            href={`/dashboard/installations/${dbId}`}
            className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
          >
            返回 installation 详情
          </Link>
          <Link
            href={`https://github.com/${report.repo.owner}/${report.repo.repo}/actions`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          >
            打开 GitHub Actions
          </Link>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "info" | "warn" | "muted";
}) {
  const cls =
    tone === "warn"
      ? "text-warning"
      : tone === "info"
        ? "text-info"
        : "text-muted-foreground";
  return (
    <div className="rounded-md border bg-card p-2 text-center">
      <div className={`text-lg font-semibold ${cls}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Icon({ outcome }: { outcome: string }) {
  const glyph =
    outcome === "created" || outcome === "updated"
      ? "✓"
      : outcome === "failed"
        ? "✗"
        : outcome === "skipped"
          ? "→"
          : "·";
  const cls =
    outcome === "failed"
      ? "text-destructive"
      : outcome === "created" || outcome === "updated"
        ? "text-info"
        : "text-muted-foreground";
  return <span className={cls}>{glyph}</span>;
}
