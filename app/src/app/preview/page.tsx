import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Check,
  Clock,
  Coins,
  KeyRound,
  Plus,
  Receipt,
  Trash2,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const dynamic = "force-static";

const MOCK_RUNS = [
  { id: 42, issueNumber: 188, prNumber: 191, stage: "review", status: "in-review", tokens: 24500, startedAt: "2026-07-18T14:23:00Z" },
  { id: 41, issueNumber: 187, prNumber: 189, stage: "test", status: "running", tokens: 51200, startedAt: "2026-07-18T13:11:00Z" },
  { id: 40, issueNumber: 185, prNumber: 186, stage: "merge", status: "queued", tokens: 88900, startedAt: "2026-07-18T11:02:00Z" },
  { id: 39, issueNumber: 182, prNumber: 183, stage: "verify", status: "failed", tokens: 12300, startedAt: "2026-07-18T09:45:00Z" },
  { id: 38, issueNumber: 180, prNumber: 181, stage: "done", status: "merged", tokens: 134200, startedAt: "2026-07-18T08:30:00Z" },
] as const;

const MOCK_INSTALLATIONS = [
  { id: 1, login: "akushonkamen", repo: "github-auto-dev-scaffold", type: "User", runsCount: 42, isActive: true },
  { id: 2, login: "akushonkamen", repo: "side-project-x", type: "User", runsCount: 7, isActive: false },
  { id: 3, login: "startup-co", repo: "mono-repo", type: "Organization", runsCount: 213, isActive: false },
] as const;

const MOCK_KEYS = [
  { id: 1, provider: "anthropic", hint: "sk-ant-…Xyz9", createdAt: "2026-07-15T10:00:00Z" },
  { id: 2, provider: "deepseek", hint: "sk-…ab12", createdAt: "2026-07-10T08:00:00Z" },
] as const;

const MOCK_USAGE = {
  totalTokens: 384204,
  totalCostUsd: 4.8234,
  totalMinutes: 92.5,
  totalRuns: 42,
};
const MOCK_STAGE = [
  { stage: "develop", tokens: 184000, costUsd: 2.34, calls: 38 },
  { stage: "triage", tokens: 89000, costUsd: 0.42, calls: 42 },
  { stage: "verify", tokens: 64000, costUsd: 1.21, calls: 38 },
  { stage: "test", tokens: 32000, costUsd: 0.51, calls: 22 },
  { stage: "review", tokens: 15204, costUsd: 0.34, calls: 18 },
] as const;
const MOCK_MODEL = [
  { model: "claude-opus-4-7", tokens: 220000, costUsd: 3.85, calls: 41 },
  { model: "claude-sonnet-4-6", tokens: 144204, costUsd: 0.82, calls: 102 },
  { model: "claude-haiku-4-5", tokens: 20000, costUsd: 0.15, calls: 15 },
] as const;

function fmtDate(s: string): string {
  return s.replace("T", " ").slice(0, 19) + " UTC";
}
function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function statusVariant(status: string) {
  if (status === "merged") return { variant: "success" as const, label: "merged" };
  if (status === "failed") return { variant: "destructive" as const, label: "failed" };
  if (status === "running") return { variant: "info" as const, label: "running" };
  if (status === "queued") return { variant: "warning" as const, label: "queued" };
  return { variant: "secondary" as const, label: status };
}

function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </header>
  );
}

export default function PreviewPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Banner */}
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="warning">UI Preview</Badge>
              <span className="text-muted-foreground">
                mock 数据 · 绕过 auth/DB · 用顶部 tab 切换 6 个页面
              </span>
            </div>
            <Link href="/" className="text-xs text-muted-foreground underline underline-offset-2">
              返回首页
            </Link>
          </CardContent>
        </Card>

        <Tabs defaultValue="dashboard" className="space-y-6">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
            <TabsTrigger value="dashboard">1. Dashboard</TabsTrigger>
            <TabsTrigger value="runs">2. Runs 列表</TabsTrigger>
            <TabsTrigger value="run-detail">3. Run 详情</TabsTrigger>
            <TabsTrigger value="usage">4. Usage 用量</TabsTrigger>
            <TabsTrigger value="engines">5. 引擎密钥</TabsTrigger>
            <TabsTrigger value="billing">6. 订阅配额</TabsTrigger>
          </TabsList>

          {/* 1. Dashboard */}
          <TabsContent value="dashboard" className="space-y-4">
            <PageHeader title="Dashboard" subtitle="管理你的 GitHub App 安装与运行。" />
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground">
                App Installations · <span className="font-mono text-foreground">{MOCK_INSTALLATIONS.length}</span>
              </h2>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4" />
                添加安装
              </Button>
            </div>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {MOCK_INSTALLATIONS.map((i) => (
                <li key={i.id}>
                  <Card
                    className={
                      "h-full transition-colors " +
                      (i.isActive
                        ? "border-primary/50 ring-1 ring-primary/30"
                        : "hover:border-foreground/20")
                    }
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <span className="truncate font-mono">{i.login}</span>
                          </CardTitle>
                          <CardDescription className="flex items-center gap-2">
                            <Badge variant="outline" className="font-normal">{i.type}</Badge>
                            {i.isActive && (
                              <Badge variant="success" className="gap-1">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                                Active
                              </Badge>
                            )}
                          </CardDescription>
                        </div>
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="truncate text-sm text-muted-foreground">
                        <span className="font-mono">{i.login}/{i.repo}</span>
                      </div>
                      <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                        <span>
                          <span className="font-mono text-foreground">
                            {i.runsCount.toLocaleString()}
                          </span>{" "}
                          runs
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </TabsContent>

          {/* 2. Runs list */}
          <TabsContent value="runs" className="space-y-4">
            <PageHeader
              title="Runs · akushonkamen/github-auto-dev-scaffold"
              subtitle="该安装的所有 Issue → PR 自动化运行。"
            />
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Issue</TableHead>
                    <TableHead>阶段</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">AI Tokens</TableHead>
                    <TableHead>开始</TableHead>
                    <TableHead>PR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {MOCK_RUNS.map((r) => {
                    const v = statusVariant(r.status);
                    const live = r.status === "running" || r.status === "in-review";
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium text-primary">
                          <span className="font-mono">#{r.issueNumber}</span>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs">{r.stage}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={v.variant} className="gap-1.5">
                            {live && (
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                            )}
                            {v.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {r.tokens.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(r.startedAt)}
                        </TableCell>
                        <TableCell className="font-mono text-primary">#{r.prNumber}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* 3. Run detail */}
          <TabsContent value="run-detail" className="space-y-4">
            <PageHeader title="Run #42 · Issue #188" subtitle="review 阶段 · PR #191 已开" />
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <CardTitle className="text-xl">
                      Run #42 <span className="text-muted-foreground">·</span>{" "}
                      <span className="font-mono text-base text-muted-foreground">Issue #188</span>
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2">
                      <Badge variant="info" className="gap-1.5">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                        实时
                      </Badge>
                      <span>当前阶段: <span className="font-mono text-foreground">review</span></span>
                    </CardDescription>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href="#">
                      打开 PR #191
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                  {[
                    ["状态", "in-review", true],
                    ["PR", "#191", false],
                    ["当前阶段", "review", true],
                    ["AI Tokens", "24,500", true],
                    ["AI 分钟", "8.20", true],
                    ["开始", fmtDate("2026-07-18T14:23:00Z"), false],
                  ].map(([label, value, mono]) => (
                    <div key={label as string} className="space-y-0.5">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {label}
                      </div>
                      <div className={mono ? "font-mono text-sm" : "text-sm"}>{value}</div>
                    </div>
                  ))}
                </div>
                <Separator className="my-4" />
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">阶段时间线</div>
                  <div className="flex flex-wrap gap-1">
                    {["triage", "clarify", "design", "develop", "verify", "test", "pr-open", "review", "merge"].map((s, i) => {
                      const done = i < 7;
                      const active = i === 7;
                      return (
                        <span
                          key={s}
                          className={
                            "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-mono " +
                            (done
                              ? "border-success/30 bg-success/10 text-success"
                              : active
                                ? "border-info/40 bg-info/10 text-info"
                                : "border-border text-muted-foreground")
                          }
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
          </TabsContent>

          {/* 4. Usage */}
          <TabsContent value="usage" className="space-y-4">
            <PageHeader title="用量统计" subtitle="按时间范围、阶段、模型查看 Token 与成本。" />
            <Tabs defaultValue="7d">
              <TabsList>
                <TabsTrigger value="7d">7 天</TabsTrigger>
                <TabsTrigger value="30d">30 天</TabsTrigger>
                <TabsTrigger value="all">全部</TabsTrigger>
              </TabsList>
              <TabsContent value="7d" className="space-y-4">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {[
                    { label: "总 Tokens", value: MOCK_USAGE.totalTokens.toLocaleString(), icon: Activity },
                    { label: "总成本", value: fmtUsd(MOCK_USAGE.totalCostUsd), icon: Receipt },
                    { label: "AI 分钟", value: MOCK_USAGE.totalMinutes.toFixed(2), icon: Clock },
                    { label: "Runs 数", value: MOCK_USAGE.totalRuns.toLocaleString(), icon: Coins },
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

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">按阶段</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {MOCK_STAGE.map((s) => (
                        <div key={s.stage} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-mono">{s.stage}</span>
                            <span className="text-muted-foreground">
                              <span className="font-mono">{s.tokens.toLocaleString()}</span>
                              {" · "}
                              {fmtUsd(s.costUsd)}
                              {" · "}
                              {s.calls} calls
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${(s.tokens / 184000) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">按模型</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {MOCK_MODEL.map((m) => (
                        <div key={m.model} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-mono">{m.model}</span>
                            <span className="text-muted-foreground">
                              <span className="font-mono">{m.tokens.toLocaleString()}</span>
                              {" · "}
                              {fmtUsd(m.costUsd)}
                              {" · "}
                              {m.calls} calls
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                            <div
                              className="h-full bg-info"
                              style={{ width: `${(m.tokens / 220000) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
              <TabsContent value="30d">
                <Card><CardContent className="p-6 text-sm text-muted-foreground">30 天数据占位</CardContent></Card>
              </TabsContent>
              <TabsContent value="all">
                <Card><CardContent className="p-6 text-sm text-muted-foreground">全部数据占位</CardContent></Card>
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* 5. Engines */}
          <TabsContent value="engines" className="space-y-4">
            <PageHeader
              title="引擎密钥（BYOK）"
              subtitle="所有密钥以 AES-256-GCM 加密存储，明文仅在调用 LLM 时短暂解密。"
            />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">添加密钥</CardTitle>
                  <CardDescription>选择 provider 并粘贴 API key。HTTPS 传输，服务端立即加密。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="provider">Provider</Label>
                    <select
                      id="provider"
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      defaultValue="anthropic"
                    >
                      <option value="anthropic">Anthropic</option>
                      <option value="openai">OpenAI</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="apikey">API Key</Label>
                    <Input id="apikey" type="password" placeholder="sk-..." className="font-mono" />
                    <p className="text-[11px] text-muted-foreground">
                      只在提交时通过 HTTPS 传输；服务端立刻加密。
                    </p>
                  </div>
                  <Button type="button">保存密钥</Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">已保存的密钥</CardTitle>
                  <CardDescription>
                    共 <span className="font-mono">{MOCK_KEYS.length}</span> 个 · 仅显示末四位
                  </CardDescription>
                </CardHeader>
                <CardContent className="divide-y p-0">
                  {MOCK_KEYS.map((k) => (
                    <div key={k.id} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-mono">{k.provider}</span>
                          <span className="text-muted-foreground">{k.hint}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          创建于 {fmtDate(k.createdAt)}
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 6. Billing */}
          <TabsContent value="billing" className="space-y-4">
            <PageHeader
              title="订阅与配额"
              subtitle="月度 token 配额按 UTC 月初重置。"
            />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardDescription>当前 Plan</CardDescription>
                  <CardTitle className="text-3xl">Free</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button>升级到 Pro</Button>
                </CardContent>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">本月用量</CardTitle>
                  <CardDescription>100,000 tokens / 月 · Free plan</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">已用</span>
                    <span className="font-mono">
                      <strong>42,500</strong> / 100,000 tokens
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded bg-muted">
                    <div className="h-full bg-primary" style={{ width: "42.5%" }} />
                  </div>
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>剩余 57,500 tokens</span>
                    <span>42.5% 已用</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
