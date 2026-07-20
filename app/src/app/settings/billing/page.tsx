import Link from "next/link";
import { redirect } from "next/navigation";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getTenantIdForSessionUser } from "@/lib/tenant";
import { checkQuota } from "@/lib/quota";
import { BillingActions } from "./BillingActions";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/settings/billing");

  const tenantId = await getTenantIdForSessionUser(session);
  if (tenantId === null) {
    return (
      <main className="flex min-h-screen flex-col items-center gap-4 p-8">
        <h1 className="text-2xl font-bold">Tenant 未初始化</h1>
        <Link href="/dashboard" className="text-primary underline">
          返回 Dashboard
        </Link>
      </main>
    );
  }

  const quota = await checkQuota(tenantId);
  const pct =
    quota.limit === Number.POSITIVE_INFINITY
      ? 0
      : Math.min(100, (quota.used / quota.limit) * 100);
  const limitLabel =
    quota.limit === Number.POSITIVE_INFINITY ? "∞" : quota.limit.toLocaleString();
  const remainingLabel =
    quota.remaining === Number.POSITIVE_INFINITY
      ? "∞"
      : quota.remaining.toLocaleString();

  const planLabel = { free: "Free", pro: "Pro", enterprise: "Enterprise" }[
    quota.plan
  ];

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="w-full max-w-2xl">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground underline"
        >
          ← Dashboard
        </Link>
      </div>

      <header className="w-full max-w-2xl space-y-1">
        <h1 className="text-2xl font-bold">订阅与配额</h1>
        <p className="text-sm text-muted-foreground">
          月度 token 配额按 UTC 月初重置。Free 档位超额时新 run 会被阻断。
        </p>
      </header>

      <section className="w-full max-w-2xl space-y-3 rounded-lg border p-4">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              当前 plan
            </div>
            <div className="text-2xl font-bold">{planLabel}</div>
          </div>
          <BillingActions plan={quota.plan} />
        </div>

        <div className="space-y-1 pt-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">本月用量</span>
            <span>
              <strong>{quota.used.toLocaleString()}</strong> / {limitLabel} tokens
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded bg-muted">
            <div
              className={
                "h-full " + (pct >= 90 ? "bg-destructive" : "bg-primary")
              }
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            剩余 {remainingLabel} tokens ·{" "}
            {pct >= 100 ? "已超额，新 run 将被阻断" : `${pct.toFixed(1)}% 已用`}
          </div>
        </div>
      </section>
    </main>
  );
}
