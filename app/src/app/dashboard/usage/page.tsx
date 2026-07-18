import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/auth/config";
import { getTenantIdForSessionUser } from "@/lib/tenant";
import {
  getUsageSummary,
  getUsageByStage,
  getUsageByModel,
  getRecentRunsForTenant,
} from "@/lib/usage-queries";

// ── Types ───────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

// ── Constants ───────────────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All time" },
] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseSince(range: string | undefined): Date | null {
  switch (range) {
    case "7d":
      return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    default:
      return null; // all-time
  }
}

function fmtDate(value: Date | string | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function fmtUsd(cents: number): string {
  return `$${cents.toFixed(2)}`;
}

function fmtNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtMinutes(minutes: number): string {
  if (minutes < 1) return `${(minutes * 60).toFixed(0)}s`;
  return `${minutes.toFixed(1)} min`;
}

/**
 * Compute percentage of a value relative to a total, clamped to [0, 100].
 */
function pct(value: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((value / total) * 100));
}

// ── Sub-components ──────────────────────────────────────────────────────────

function RangeNav({ current }: { current: string | undefined }) {
  return (
    <nav className="flex items-center gap-2 rounded-md border p-1 text-sm">
      {RANGE_OPTIONS.map((opt) => {
        const isActive = (current ?? "all") === opt.value;
        const href =
          opt.value === "all"
            ? "/dashboard/usage"
            : `/dashboard/usage?range=${opt.value}`;
        return isActive ? (
          <span
            key={opt.value}
            className="rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground"
          >
            {opt.label}
          </span>
        ) : (
          <Link
            key={opt.value}
            href={href}
            className="rounded-md px-3 py-1 hover:bg-accent"
          >
            {opt.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SummaryCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
      </p>
    </div>
  );
}

function BreakdownTable<T extends { callsCount: number }>({
  rows,
  labelKey,
  totalCost,
  maxCost,
}: {
  rows: T[];
  labelKey: keyof T;
  totalCost: number;
  maxCost: number;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No usage data yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-2 pr-4">Item</th>
            <th className="py-2 pr-4 text-right">Input tokens</th>
            <th className="py-2 pr-4 text-right">Output tokens</th>
            <th className="py-2 pr-4 text-right">Cost (USD)</th>
            <th className="py-2 pr-4 text-right">%</th>
            <th className="py-2 pr-4 text-right">Calls</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const itemCost = Number((row as unknown as Record<string, unknown>).costUsd ?? 0);
            const width = pct(itemCost, maxCost);
            return (
              <tr key={String(row[labelKey]) ?? i} className="border-t">
                <td className="py-2 pr-4 font-mono text-xs">
                  {String(row[labelKey])}
                </td>
                <td className="py-2 pr-4 text-right">
                  {fmtNumber(Number((row as unknown as Record<string, unknown>).inputTokens ?? 0))}
                </td>
                <td className="py-2 pr-4 text-right">
                  {fmtNumber(Number((row as unknown as Record<string, unknown>).outputTokens ?? 0))}
                </td>
                <td className="py-2 pr-4 text-right">
                  {fmtUsd(itemCost)}
                </td>
                <td className="py-2 pr-4 text-right text-muted-foreground">
                  {pct(itemCost, totalCost)}%
                </td>
                <td className="py-2 pr-4 text-right">{row.callsCount}</td>
                <td className="w-24 py-2">
                  <div className="h-2 w-full rounded-full bg-accent">
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function UsagePage({ searchParams }: PageProps) {
  const { range } = await searchParams;
  const since = parseSince(range);

  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/dashboard/usage");

  // Resolve tenant id from session — never from query params (S4 / defense-in-depth).
  const tenantId = await getTenantIdForSessionUser(session);
  if (!tenantId) {
    return (
      <main className="flex min-h-screen flex-col items-center gap-4 p-8">
        <h1 className="text-2xl font-bold">Not ready</h1>
        <p className="text-muted-foreground">
          No tenant record found for your account. Install the GitHub App first.
        </p>
        <Link href="/dashboard" className="text-primary underline">
          Back to dashboard
        </Link>
      </main>
    );
  }

  const [summary, stageRows, modelRows, recentRuns] = await Promise.all([
    getUsageSummary(tenantId, since),
    getUsageByStage(tenantId, since),
    getUsageByModel(tenantId, since),
    getRecentRunsForTenant(tenantId, 20),
  ]);

  // Pre-compute max cost for bar widths.
  const maxStageCost = Math.max(...stageRows.map((r) => r.costUsd), 0);
  const maxModelCost = Math.max(...modelRows.map((r) => r.costUsd), 0);

  return (
    <main className="flex min-h-screen flex-col items-center gap-8 p-8">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex w-full max-w-5xl flex-col gap-4">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground underline"
        >
          ← Dashboard
        </Link>
        <header className="flex items-baseline justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Usage</h1>
          <RangeNav current={range} />
        </header>
      </div>

      {/* ── Summary cards ──────────────────────────────────────────────── */}
      <section className="grid w-full max-w-5xl grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryCard
          label="Total tokens"
          value={fmtNumber(summary.totalTokens)}
        />
        <SummaryCard
          label="Total cost"
          value={fmtUsd(summary.totalCostUsd)}
        />
        <SummaryCard
          label="AI time"
          value={fmtMinutes(summary.totalMinutes)}
        />
        <SummaryCard
          label="Total runs"
          value={fmtNumber(summary.totalRuns)}
          unit="runs"
        />
      </section>

      {/* ── By stage ──────────────────────────────────────────────────── */}
      <section className="w-full max-w-5xl space-y-4">
        <h2 className="text-xl font-semibold">By stage</h2>
        <BreakdownTable
          rows={stageRows}
          labelKey="stage"
          totalCost={summary.totalCostUsd}
          maxCost={maxStageCost}
        />
      </section>

      {/* ── By model ──────────────────────────────────────────────────── */}
      <section className="w-full max-w-5xl space-y-4">
        <h2 className="text-xl font-semibold">By model</h2>
        <BreakdownTable
          rows={modelRows}
          labelKey="model"
          totalCost={summary.totalCostUsd}
          maxCost={maxModelCost}
        />
      </section>

      {/* ── Recent runs ────────────────────────────────────────────────── */}
      <section className="w-full max-w-5xl space-y-4">
        <h2 className="text-xl font-semibold">Recent runs</h2>
        {recentRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">Repo</th>
                  <th className="py-2 pr-4">Issue</th>
                  <th className="py-2 pr-4">Stage</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4 text-right">Tokens</th>
                  <th className="py-2 pr-4">Started</th>
                  <th className="py-2 pr-4">PR</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2 pr-4 font-mono text-xs">
                      {r.repoFullName}
                    </td>
                    <td className="py-2 pr-4">
                      <Link
                        href={`/dashboard/installations/${r.installationId}/runs/${r.id}`}
                        className="text-primary underline"
                      >
                        #{r.issueNumber}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {r.currentStage ?? "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {r.status ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {r.aiTokensUsed != null
                        ? fmtNumber(r.aiTokensUsed)
                        : "—"}
                    </td>
                    <td className="py-2 pr-4 text-xs">
                      {fmtDate(r.startedAt)}
                    </td>
                    <td className="py-2 pr-4">
                      {r.prNumber ? (
                        <span className="font-mono text-xs">
                          #{r.prNumber}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
