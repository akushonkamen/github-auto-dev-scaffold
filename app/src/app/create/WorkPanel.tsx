"use client";

import Link from "next/link";
import { ArrowUpRight, Check, ChevronRight, Rocket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BuildRail, type Station, type StationStatus } from "@/components/build-rail";
import { cn } from "@/lib/utils";

interface RunSnapshot {
  id: number;
  issueNumber: number;
  prNumber: number | null;
  currentStage: string | null;
  status: string | null;
}

interface Props {
  stage: "draft" | RunSnapshot;
  repoFullName: string;
  installationDbId: number;
}

// Stage → station order. Each station id matches `runs.currentStage`.
const STAGES_DEF: StationDef[] = [
  { id: "triage", label: "收到需求", tag: "triage", desc: "AI 已理解你要做什么" },
  { id: "clarify", label: "确认细节", tag: "clarify", desc: "AI 会问几个问题，回答后开工" },
  { id: "develop", label: "开发中", tag: "in-development", desc: "AI 编写并提交代码" },
  { id: "verify", label: "自动检查", tag: "verify / test", desc: "自测失败会自动重试，最多三次" },
  { id: "review", label: "请你验收", tag: "in-review", desc: "给你一个能试用的预览" },
  { id: "merged", label: "上线", tag: "merged", desc: "你点满意后自动发布" },
];

interface StationDef {
  id: string;
  label: string;
  tag: string;
  desc: string;
}

function matchStageId(currentStage: string | null): string | null {
  if (!currentStage) return null;
  // Normalize alias: "testing" / "tested" → "verify"; "in-review" → "review".
  const s = currentStage.toLowerCase();
  if (s === "testing" || s === "tested") return "verify";
  if (s === "in-review") return "review";
  if (s === "pr-open") return "review";
  if (STAGES_DEF.some((x) => x.id === s)) return s;
  return null;
}

function buildStations(currentStage: string | null): Station[] {
  const idx = matchStageId(currentStage);
  const activeIdx = idx ? STAGES_DEF.findIndex((s) => s.id === idx) : -1;
  return STAGES_DEF.map((s, i) => {
    let status: StationStatus = "pending";
    if (activeIdx >= 0) {
      if (i < activeIdx) status = "done";
      else if (i === activeIdx) status = "now";
    }
    return {
      id: s.id,
      label: s.label,
      tag: s.tag,
      description: s.desc,
      status,
    };
  });
}

export function WorkPanel({ stage, repoFullName, installationDbId }: Props) {
  if (stage === "draft") {
    return <DraftCard repoFullName={repoFullName} />;
  }

  const currentStage = stage.currentStage;
  const stations = buildStations(currentStage);

  if (stage.status === "merged") {
    return <MergedCard repoFullName={repoFullName} prNumber={stage.prNumber} />;
  }
  if (matchStageId(currentStage) === "review") {
    return (
      <ReviewCard
        repoFullName={repoFullName}
        prNumber={stage.prNumber}
        installationDbId={installationDbId}
        runId={stage.id}
      />
    );
  }
  if (stage.status === "failed") {
    return <FailedCard repoFullName={repoFullName} issueNumber={stage.issueNumber} />;
  }
  return <ProgressCard stations={stations} stage={stage} repoFullName={repoFullName} />;
}

/* ─── Draft ─── */
function DraftCard({ repoFullName }: { repoFullName: string }) {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="space-y-1">
        <h3 className="font-serif text-lg font-extrabold text-ink">
          还没开始
        </h3>
        <p className="text-sm text-muted-foreground">
          左边写一句话，点「开始造」。AI 会在
          <span className="font-mono text-foreground"> {repoFullName} </span>
          仓库创建 Issue 并接手。
        </p>
      </div>

      <ul className="space-y-2.5 text-sm text-muted-foreground">
        <li className="flex gap-2.5">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-work" />
          草稿不会发到 GitHub，编辑多次都行
        </li>
        <li className="flex gap-2.5">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-work" />
          创建 Issue 后自动跑 triage → clarify → develop → verify
        </li>
        <li className="flex gap-2.5">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-work" />
          你可以随时离开页面，进展通过 SSE 实时刷新
        </li>
      </ul>

      <div className="mt-auto rounded-md border border-dashed bg-cream/30 p-3 text-xs text-muted-foreground">
        想换一个仓库？去
        <Link
          href="/dashboard"
          className="mx-1 inline-flex items-center gap-0.5 text-work underline-offset-2 hover:underline"
        >
          Dashboard
          <ChevronRight className="h-3 w-3" />
        </Link>
        切换 active installation。
      </div>
    </div>
  );
}

/* ─── Progress（triage / clarify / develop / verify） ─── */
function ProgressCard({
  stations,
  stage,
  repoFullName,
}: {
  stations: Station[];
  stage: RunSnapshot;
  repoFullName: string;
}) {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="space-y-1">
        <h3 className="font-serif text-lg font-extrabold text-ink">建造进度</h3>
        <p className="text-xs text-muted-foreground">
          每一站完成后自动前进，出问题会先自己修
        </p>
      </div>

      <BuildRail stations={stations} variant="vertical" />

      <div className="mt-auto border-t border-dashed pt-3 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>
            <Badge variant="outline" className="mr-2 font-mono text-[10px]">
              stage
            </Badge>
            <span className="font-mono text-foreground">
              {stage.currentStage ?? "?"}
            </span>
          </span>
          <Link
            href={`https://github.com/${repoFullName}/issues/${stage.issueNumber}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-work hover:underline"
          >
            查看 Issue
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ─── Review（in-review 阶段） ─── */
function ReviewCard({
  repoFullName,
  prNumber,
  installationDbId,
  runId,
}: {
  repoFullName: string;
  prNumber: number | null;
  installationDbId: number;
  runId: number;
}) {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="space-y-1">
        <h3 className="font-serif text-lg font-extrabold text-ink">验收单</h3>
        <p className="text-sm text-muted-foreground">
          AI 已经自测过一遍，请你看看结果。
        </p>
      </div>

      <ul className="space-y-2 text-sm text-muted-foreground">
        <li className="flex gap-2.5">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-work" />
          功能自测通过
        </li>
        <li className="flex gap-2.5">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-work" />
          自动化测试通过
        </li>
        <li className="flex gap-2.5">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-work" />
          代码评审无阻塞
        </li>
      </ul>

      {prNumber != null ? (
        <a
          href={`https://github.com/${repoFullName}/pull/${prNumber}`}
          target="_blank"
          rel="noreferrer"
          className="block rounded-md border border-border bg-cream/30 px-3 py-2 text-sm hover:border-work/40"
        >
          <div className="flex items-center justify-between">
            <span>
              PR <span className="font-mono">#{prNumber}</span>
            </span>
            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
            github.com/{repoFullName}/pull/{prNumber}
          </div>
        </a>
      ) : (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          PR 号未上报，去 Issue 查看。
        </div>
      )}

      <Button
        asChild
        className="mt-auto w-full bg-success text-success-foreground hover:bg-success/90"
      >
        <Link href={`/dashboard/installations/${installationDbId}/runs/${runId}`}>
          <Check className="mr-1.5 h-4 w-4" />
          去详情页验收
        </Link>
      </Button>
      <p className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-mono text-[10px]">PR approve + merge</span>
        将触发上线。点击上方按钮跳到 run 详情页查看完整时间轴。
      </p>
    </div>
  );
}

/* ─── Merged（已上线） ─── */
function MergedCard({
  repoFullName,
  prNumber,
}: {
  repoFullName: string;
  prNumber: number | null;
}) {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="space-y-1">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-bold text-success">
          <Rocket className="h-3 w-3" />
          已上线
        </div>
        <h3 className="font-serif text-lg font-extrabold text-ink">
          造好了 🎉
        </h3>
      </div>
      <p className="text-sm text-muted-foreground">
        你的需求已经合入主线。
      </p>
      {prNumber != null && (
        <Link
          href={`https://github.com/${repoFullName}/pull/${prNumber}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-work hover:underline"
        >
          查看 PR #{prNumber}
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      )}
      <Button asChild className="mt-auto w-full bg-work text-white hover:bg-work/90">
        <Link href="/create">再造一个</Link>
      </Button>
    </div>
  );
}

/* ─── Failed ─── */
function FailedCard({
  repoFullName,
  issueNumber,
}: {
  repoFullName: string;
  issueNumber: number;
}) {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="space-y-1">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-fail-soft px-2.5 py-1 text-xs font-bold text-fail">
          出错了
        </div>
        <h3 className="font-serif text-lg font-extrabold text-ink">
          这次没成功
        </h3>
      </div>
      <p className="text-sm text-muted-foreground">
        AI 在某个阶段失败了。Issue 上的评论有详细原因。
      </p>
      <Button asChild variant="outline" className="mt-auto w-full">
        <Link
          href={`https://github.com/${repoFullName}/issues/${issueNumber}`}
          target="_blank"
          rel="noreferrer"
        >
          查看 Issue 详情
          <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
        </Link>
      </Button>
    </div>
  );
}
