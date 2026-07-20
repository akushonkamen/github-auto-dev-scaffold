"use client";

import type { DiffReport } from "@/lib/deploy-pipeline";
import type { DryRunResult } from "./actions";

interface Props {
  scan: DryRunResult;
  overrides: Set<string>;
  onToggleOverride: (path: string) => void;
  onContinue: () => void;
}

export function ScanStep({ scan, overrides, onToggleOverride, onContinue }: Props) {
  if (!scan.ok || !scan.report) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm">
        <p className="font-medium text-destructive">扫描失败</p>
        <p className="mt-1 text-muted-foreground break-all">{scan.error}</p>
      </div>
    );
  }

  const report: DiffReport = scan.report;
  const conflicts = report.files.filter((f) => f.status === "conflict");

  return (
    <div className="space-y-4">
      {report.warnings && report.warnings.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="font-medium">部分子扫描失败（不影响部署）</p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {report.warnings.map((w, i) => (
              <li key={i} className="break-all">{w}</li>
            ))}
          </ul>
          <p className="mt-2 text-muted-foreground">
            Vars/secrets 会在部署时用 PAT 写入，无需扫描也能继续。
          </p>
        </div>
      )}
      <section className="rounded-md border p-4">
        <h2 className="text-lg font-semibold">
          仓库：{report.repo.owner}/{report.repo.repo}（默认分支 {report.repo.defaultBranch}）
        </h2>
        <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
          <CountCell label="文件新增" value={report.counts.filesNew} tone="info" />
          <CountCell label="文件已存在" value={report.counts.filesSkip} tone="muted" />
          <CountCell label="文件冲突" value={report.counts.filesConflict} tone="warn" />
          <CountCell label="Labels 新增" value={report.counts.labelsNew} tone="info" />
          <CountCell label="Labels 已存在" value={report.counts.labelsExisting} tone="muted" />
          <CountCell label="Vars 新增" value={report.counts.varsNew} tone="info" />
        </div>
      </section>

      <section className="rounded-md border p-4">
        <h3 className="text-md font-semibold mb-2">分支保护</h3>
        <ul className="text-sm space-y-1">
          {report.branchProtection.map((bp) => (
            <li key={bp.branch} className="flex justify-between">
              <code className="text-muted-foreground">{bp.branch}</code>
              <span className={bp.status === "new" ? "text-info" : "text-muted-foreground"}>
                {bp.status === "new" ? "待创建 ruleset" : "已有保护"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {conflicts.length > 0 && (
        <section className="rounded-md border border-warning/40 p-4">
          <h3 className="text-md font-semibold">冲突文件（默认不覆盖）</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            勾选代表「允许覆盖目标 repo 已有内容」。未勾选的冲突文件部署时跳过。
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {conflicts.map((f) => (
              <li key={f.path}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={overrides.has(f.path)}
                    onChange={() => onToggleOverride(f.path)}
                  />
                  <code className="text-muted-foreground">{f.path}</code>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
        >
          下一步：配置
        </button>
      </div>
    </div>
  );
}

function CountCell({
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
    <div className="rounded-md border bg-card p-2">
      <div className={`text-lg font-semibold ${cls}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
