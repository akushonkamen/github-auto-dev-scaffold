import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, Clock, Coins, Receipt } from "lucide-react";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getTenantIdForSessionUser } from "@/lib/tenant";
import {
  getRecentRunsForTenant,
  getUsageByModel,
  getUsageByStage,
  getUsageSummary,
  rangeToSince,
} from "@/lib/usage-queries";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

const RANGES = [
  { key: "7d", label: "7 天" },
  { key: "30d", label: "30 天" },
  { key: "all", label: "全部" },
] as const;

function fmtDate(value: Date | string | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function statusVariant(status: string | null) {
  if (!status) return { variant: "secondary" as const, label: "—" };
  if (status === "merged") return { variant: "success" as const, label: status };
  if (status === "failed") return { variant: "destructive" as const, label: status };
  if (status === "running" || status === "in-review")
    return { variant: "info" as const, label: status };
  if (status === "queued" || status === "dispatched")
    return { variant: "warning" as const, label: status };
  return { variant: "secondary" as const, label: status };
}

export default async function UsagePage({ searchParams }: PageProps) {
  const { range } = await searchParams;
  const since = rangeToSince(range);
  const activeRange = RANGES.some((r) => r.key === range) ? range! : "all";

  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(`/login?callbackUrl=/dashboard/usage`);

  const tenantId = await getTenantIdForSessionUser(session);
  if (tenantId === null) {
    return (
      <AppShell>
        <Card className="mx-auto max-w-md">
          <CardHeader>
            <CardTitle>Tenant 未初始化</CardTitle>
            <CardDescription>
              安装 GitHub App 后才会自动创建 tenant 行；请先完成 installation。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/dashboard"
              className="text-sm text-primary underline underline-offset-2"
            >
              返回 Dashboard
            </Link>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const [summary, byStage, byModel, recent] = await Promise.all([
    getUsageSummary(tenantId, since),
    getUsageByStage(tenantId, since),
    getUsageByModel(tenantId, since),
    getRecentRunsForTenant(tenantId, 20),
  ]);

  const maxStageTokens = Math.max(1, ...byStage.map((s) => s.totalTokens));
  const maxModelTokens = Math.max(1, ...byModel.map((m) => m.totalTokens));

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">用量统计</h1>
            <p className="text-sm text-muted-foreground">
              按时间范围、阶段、模型查看 Token 与成本。
            </p>
          </div>
          <nav className="inline-flex h-9 items-center justify-center rounded-md border bg-muted/40 p-1 text-muted-foreground">
            {RANGES.map((r) => {
              const active = activeRange === r.key;
              return (
                <Link
                  key={r.key}
                  href={`/dashboard/usage?range=${r.key}`}
                  className={cn(
                    "inline-flex h-7 items-center justify-center rounded-sm px-3 text-xs font-medium transition-all",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "hover:text-foreground",
                  )}
                >
                  {r.label}
                </Link>
              );
            })}
          </nav>
        </header>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "总 Tokens", value: summary.totalTokens.toLocaleString(), icon: Activity },
            { label: "总成本", value: fmtUsd(summary.totalCostUsd), icon: Receipt },
            { label: "AI 分钟", value: summary.totalMinutes.toFixed(2), icon: Clock },
            { label: "Runs 数", value: summary.totalRuns.toLocaleString(), icon: Coins },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.label}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {s.label}
                    </div>
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="font-mono text-xl font-semibold">{s.value}</div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Breakdowns */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">按阶段</CardTitle>
              <CardDescription>
                {byStage.length === 0 ? "暂无数据" : `${byStage.length} 个阶段`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {byStage.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无数据。</p>
              ) : (
                byStage.map((s) => (
                  <div key={s.stage} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono">{s.stage}</span>
                      <span className="text-muted-foreground">
                        <span className="font-mono">{s.totalTokens.toLocaleString()}</span>
                        {" · "}
                        {fmtUsd(s.totalCostUsd)}
                        {" · "}
                        {s.calls} calls
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${(s.totalTokens / maxStageTokens) * 100}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">按模型</CardTitle>
              <CardDescription>
                {byModel.length === 0 ? "暂无数据" : `${byModel.length} 个模型`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {byModel.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无数据。</p>
              ) : (
                byModel.map((m) => (
                  <div key={m.model} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono">{m.model}</span>
                      <span className="text-muted-foreground">
                        <span className="font-mono">{m.totalTokens.toLocaleString()}</span>
                        {" · "}
                        {fmtUsd(m.totalCostUsd)}
                        {" · "}
                        {m.calls} calls
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                      <div
                        className="h-full bg-info"
                        style={{ width: `${(m.totalTokens / maxModelTokens) * 100}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent runs */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">最近 20 条 Runs</CardTitle>
            <CardDescription>跨所有 installation 的最近活动</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {recent.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">暂无 runs。</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Issue</TableHead>
                    <TableHead>Repo</TableHead>
                    <TableHead>阶段</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">分钟</TableHead>
                    <TableHead>开始</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((r) => {
                    const v = statusVariant(r.status);
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Link
                            href={`/dashboard/installations/${r.installationId}/runs/${r.id}`}
                            className="font-mono text-primary underline underline-offset-2"
                          >
                            #{r.issueNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.repoFullName ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.currentStage ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={v.variant}>{v.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {r.aiTokensUsed.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {r.aiMinutesUsed.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(r.startedAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
