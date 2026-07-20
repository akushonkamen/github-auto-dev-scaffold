"use client";

import { useState } from "react";
import Link from "next/link";

import type { ApplyReport, DiffReport } from "@/lib/deploy-pipeline";
import type { DryRunResult } from "./actions";
import { applyDeploy } from "./actions";
import { ScanStep } from "./ScanStep";
import { ConfigureStep } from "./ConfigureStep";
import { ApplyStep } from "./ApplyStep";

type Stage = "scan" | "configure" | "applying" | "done";

interface Props {
  dbId: number;
  repoFullName: string;
  defaultOwner: string;
  initialScan: DryRunResult;
}

export function DeployWizard({ dbId, repoFullName, defaultOwner, initialScan }: Props) {
  const [stage, setStage] = useState<Stage>("scan");
  const [scan, setScan] = useState<DryRunResult>(initialScan);
  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  const [config, setConfig] = useState<{
    llmKey: string;
    claudePat: string;
    claudePatOwner: string;
    baseBranch: string;
  }>({
    llmKey: "",
    claudePat: "",
    claudePatOwner: defaultOwner,
    baseBranch: "dev",
  });
  const [applyReport, setApplyReport] = useState<ApplyReport | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  function handleToggleOverride(path: string) {
    setOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function handleApply() {
    setStage("applying");
    setApplyError(null);
    const res = await applyDeploy({
      dbId,
      llmKey: config.llmKey,
      claudePat: config.claudePat,
      claudePatOwner: config.claudePatOwner,
      baseBranch: config.baseBranch,
      fileOverrides: Array.from(overrides),
    });
    if (!res.ok || !res.report) {
      setApplyError(res.error ?? "apply failed");
      setStage("configure");
      return;
    }
    setApplyReport(res.report);
    setStage("done");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href={`/dashboard/installations/${dbId}`}
          className="text-sm text-muted-foreground underline"
        >
          ← Back to {repoFullName}
        </Link>
        <h1 className="text-2xl font-bold">Deploy pipeline to {repoFullName}</h1>
        <p className="text-sm text-muted-foreground">
          3 步：扫描冲突 → 配置密钥与变量 → 部署到目标 repo。幂等，可重复运行。
        </p>
      </div>

      <StageIndicator stage={stage} />

      {stage === "scan" && (
        <ScanStep
          scan={scan}
          overrides={overrides}
          onToggleOverride={handleToggleOverride}
          onContinue={() => setStage("configure")}
        />
      )}

      {stage === "configure" && (
        <ConfigureStep
          config={config}
          onChange={setConfig}
          onBack={() => setStage("scan")}
          onApply={handleApply}
        />
      )}

      {stage === "applying" && <ApplyStep running />}

      {stage === "done" && applyReport && (
        <ApplyStep report={applyReport} dbId={dbId} error={applyError} />
      )}

      {stage === "done" && !applyReport && applyError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">部署失败</p>
          <p className="mt-1 text-muted-foreground">{applyError}</p>
          <button
            type="button"
            onClick={() => setStage("configure")}
            className="mt-3 rounded-md border px-3 py-1 text-sm hover:bg-accent"
          >
            返回重试
          </button>
        </div>
      )}
    </div>
  );
}

function StageIndicator({ stage }: { stage: Stage }) {
  const steps: { key: Stage; label: string }[] = [
    { key: "scan", label: "1. 扫描冲突" },
    { key: "configure", label: "2. 配置" },
    { key: "applying", label: "3. 部署" },
    { key: "done", label: "3. 部署" },
  ];
  const activeIdx = steps.findIndex((s) => s.key === stage);
  return (
    <ol className="flex gap-2 text-sm">
      {steps
        .filter((s, i, arr) => arr.findIndex((x) => x.label === s.label) === i)
        .map((s, i) => (
          <li
            key={s.label}
            className={
              i === activeIdx || (stage === "applying" && s.key === "applying")
                ? "rounded-md bg-primary px-3 py-1 text-primary-foreground"
                : i < activeIdx
                  ? "rounded-md border border-primary/50 px-3 py-1 text-primary"
                  : "rounded-md border px-3 py-1 text-muted-foreground"
            }
          >
            {s.label}
          </li>
        ))}
    </ol>
  );
}
