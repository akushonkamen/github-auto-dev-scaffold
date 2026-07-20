import Link from "next/link";
import { redirect } from "next/navigation";

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

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

const RANGES = [
  { key: "7d", label: "最近 7 天" },
  { key: "30d", label: "最近 30 天" },
  { key: "all", label: "全部" },
];

function fmtDate(value: Date | string | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
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
      <main className="flex min-h-screen flex-col items-center gap-4 p-8">
        <h1 className="text-2xl font-bold">Tenant 未初始化</h1>
        <p className="text-muted-foreground">
          安装 GitHub App 后才会自动创建 tenant 行；请先完成 installation。
        </p>
        <Link href="/dashboard" className="text-primary underline">
          返回 Dashboard
        </Link>
      </main>
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
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="w-full max-w-4xl">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground underline"
        >
          ← Dashboard
        </Link>
      </div>

      <header className="flex w-full max-w-4xl flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">用量统计</h1>
        <nav className="flex gap-1 text-sm">
          {RANGES.map((r) => (
            <Link
              key={r.key}
              href={`/dashboard/usage?range=${r.key}`}
              className={
                "rounded px-3 py-1 " +
                (activeRange === r.key
                  ? "bg-primary text-primary-foreground"
                  : "border")
              }
            >
              {r.label}
            </Link>
          ))}
        </nav>
      </header>

      <section className="grid w-full max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="总 Tokens" value={summary.totalTokens.toLocaleString()} />
        <SummaryCard label="总成本" value={fmtUsd(summary.totalCostUsd)} />
        <SummaryCard label="AI 分钟" value={summary.totalMinutes.toFixed(2)} />
        <SummaryCard label="Runs 数" value={summary.totalRuns.toLocaleString()} />
      </section>

      <section className="w-full max-w-4xl space-y-2">
        <h2 className="text-lg font-semibold">按阶段分解</h2>
        {byStage.length === 0 ? (
          <p className="text-muted-foreground">暂无数据。</p>
        ) : (
          <ul className="space-y-1">
            {byStage.map((s) => (
              <li key={s.stage} className="text-sm">
                <div className="flex justify-between">
                  <span className="font-mono">{s.stage}</span>
                  <span className="text-muted-foreground">
                    {s.totalTokens.toLocaleString()} tokens · {fmtUsd(s.totalCostUsd)} · {s.calls} calls
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-primary"
                    style={{
                      width: `${(s.totalTokens / maxStageTokens) * 100}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="w-full max-w-4xl space-y-2">
        <h2 className="text-lg font-semibold">按模型分解</h2>
        {byModel.length === 0 ? (
          <p className="text-muted-foreground">暂无数据。</p>
        ) : (
          <ul className="space-y-1">
            {byModel.map((m) => (
              <li key={m.model} className="text-sm">
                <div className="flex justify-between">
                  <span className="font-mono">{m.model}</span>
                  <span className="text-muted-foreground">
                    {m.totalTokens.toLocaleString()} tokens · {fmtUsd(m.totalCostUsd)} · {m.calls} calls
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-primary"
                    style={{
                      width: `${(m.totalTokens / maxModelTokens) * 100}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="w-full max-w-4xl space-y-2">
        <h2 className="text-lg font-semibold">最近 20 条 Runs</h2>
        {recent.length === 0 ? (
          <p className="text-muted-foreground">暂无 runs。</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Issue</th>
                <th className="py-2 pr-4">Repo</th>
                <th className="py-2 pr-4">阶段</th>
                <th className="py-2 pr-4">状态</th>
                <th className="py-2 pr-4">Tokens</th>
                <th className="py-2 pr-4">分钟</th>
                <th className="py-2 pr-4">开始</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/dashboard/installations/${r.installationId}/runs/${r.id}`}
                      className="text-primary underline"
                    >
                      #{r.issueNumber}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {r.repoFullName ?? "—"}
                  </td>
                  <td className="py-2 pr-4 font-mono">{r.currentStage ?? "—"}</td>
                  <td className="py-2 pr-4 font-mono">{r.status ?? "—"}</td>
                  <td className="py-2 pr-4">{r.aiTokensUsed.toLocaleString()}</td>
                  <td className="py-2 pr-4">{r.aiMinutesUsed.toFixed(2)}</td>
                  <td className="py-2 pr-4">{fmtDate(r.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1 rounded-lg border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}
