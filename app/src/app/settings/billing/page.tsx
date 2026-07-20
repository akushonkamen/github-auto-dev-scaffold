import Link from "next/link";
import { redirect } from "next/navigation";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getTenantIdForSessionUser } from "@/lib/tenant";
import { checkQuota } from "@/lib/quota";
import { BillingActions } from "./BillingActions";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/settings/billing");

  const tenantId = await getTenantIdForSessionUser(session);
  if (tenantId === null) {
    return (
      <AppShell>
        <Card className="mx-auto max-w-md">
          <CardHeader>
            <CardTitle>Tenant 未初始化</CardTitle>
            <CardDescription>请先完成 installation。</CardDescription>
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

  const quota = await checkQuota(tenantId);
  const isUnlimited = quota.limit === Number.POSITIVE_INFINITY;
  const pct = isUnlimited ? 0 : Math.min(100, (quota.used / quota.limit) * 100);
  const limitLabel = isUnlimited ? "∞" : quota.limit.toLocaleString();
  const remainingLabel = isUnlimited
    ? "∞"
    : quota.remaining.toLocaleString();
  const overQuota = !isUnlimited && pct >= 100;
  const nearQuota = !isUnlimited && pct >= 90;

  const planLabel = { free: "Free", pro: "Pro", enterprise: "Enterprise" }[quota.plan];

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">订阅与配额</h1>
          <p className="text-sm text-muted-foreground">
            月度 token 配额按 UTC 月初重置。Free 档位超额时新 run 会被阻断。
          </p>
        </header>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* Plan card */}
          <Card>
            <CardHeader>
              <CardDescription>当前 Plan</CardDescription>
              <CardTitle className="text-3xl">{planLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              <BillingActions plan={quota.plan} />
            </CardContent>
          </Card>

          {/* Usage this month */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">本月用量</CardTitle>
                  <CardDescription>
                    {limitLabel} tokens / 月 · {planLabel} plan
                  </CardDescription>
                </div>
                {overQuota ? (
                  <Badge variant="destructive">已超额</Badge>
                ) : nearQuota ? (
                  <Badge variant="warning">接近上限</Badge>
                ) : (
                  <Badge variant="success">健康</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">已用</span>
                <span className="font-mono">
                  <strong>{quota.used.toLocaleString()}</strong> / {limitLabel} tokens
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded bg-muted">
                <div
                  className={cn(
                    "h-full transition-all",
                    overQuota
                      ? "bg-destructive"
                      : nearQuota
                        ? "bg-warning"
                        : "bg-primary",
                  )}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>剩余 {remainingLabel} tokens</span>
                <span>
                  {overQuota
                    ? "新 run 将被阻断"
                    : isUnlimited
                      ? "无限制"
                      : `${pct.toFixed(1)}% 已用`}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Plans comparison */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Plans</CardTitle>
            <CardDescription>升级解锁更高配额与功能</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              {
                name: "Free",
                price: "$0",
                limit: "100K tokens/月",
                current: quota.plan === "free",
              },
              {
                name: "Pro",
                price: "$20/月",
                limit: "1M tokens/月",
                current: quota.plan === "pro",
              },
              {
                name: "Enterprise",
                price: "联系销售",
                limit: "无限",
                current: quota.plan === "enterprise",
              },
            ].map((p) => (
              <div
                key={p.name}
                className={cn(
                  "rounded-md border p-3 space-y-1",
                  p.current && "border-primary/50 ring-1 ring-primary/30",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{p.name}</span>
                  {p.current && <Badge variant="success">当前</Badge>}
                </div>
                <div className="font-mono text-lg">{p.price}</div>
                <div className="text-xs text-muted-foreground">{p.limit}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
