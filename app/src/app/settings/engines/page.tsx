import Link from "next/link";
import { redirect } from "next/navigation";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getTenantIdForSessionUser } from "@/lib/tenant";
import { listApiKeysForTenant } from "@/lib/api-keys-queries";
import { ApiKeyForm } from "./ApiKeyForm";
import { ApiKeyList } from "./ApiKeyList";

export const dynamic = "force-dynamic";

export default async function EnginesSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/settings/engines");

  const tenantId = await getTenantIdForSessionUser(session);
  if (tenantId === null) {
    return (
      <main className="flex min-h-screen flex-col items-center gap-4 p-8">
        <h1 className="text-2xl font-bold">Tenant 未初始化</h1>
        <p className="text-muted-foreground">
          安装 GitHub App 后才会自动创建 tenant 行；请先回到 dashboard 完成
          installation。
        </p>
        <Link href="/dashboard" className="text-primary underline">
          返回 Dashboard
        </Link>
      </main>
    );
  }

  const keys = await listApiKeysForTenant(tenantId);

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
        <h1 className="text-2xl font-bold">引擎密钥（BYOK）</h1>
        <p className="text-sm text-muted-foreground">
          所有密钥以 AES-256-GCM 加密存储，明文仅在调用 LLM 时短暂解密。
          UI 永远不会回显完整密钥。
        </p>
      </header>

      <section className="w-full max-w-2xl space-y-3 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">添加密钥</h2>
        <ApiKeyForm />
      </section>

      <section className="w-full max-w-2xl space-y-3">
        <h2 className="text-lg font-semibold">已保存的密钥</h2>
        {keys.length === 0 ? (
          <p className="text-muted-foreground">暂无密钥。</p>
        ) : (
          <ApiKeyList keys={keys} />
        )}
      </section>
    </main>
  );
}
