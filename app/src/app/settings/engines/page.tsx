import Link from "next/link";
import { redirect } from "next/navigation";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getTenantIdForSessionUser } from "@/lib/tenant";
import { listApiKeysForTenant } from "@/lib/api-keys-queries";
import { ApiKeyForm } from "./ApiKeyForm";
import { ApiKeyList } from "./ApiKeyList";

import { AppShell } from "@/components/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function EnginesSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/settings/engines");

  const tenantId = await getTenantIdForSessionUser(session);
  if (tenantId === null) {
    return (
      <AppShell>
        <Card className="mx-auto max-w-md">
          <CardHeader>
            <CardTitle>Tenant 未初始化</CardTitle>
            <CardDescription>
              安装 GitHub App 后才会自动创建 tenant 行；请先回到 dashboard 完成
              installation。
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

  const keys = await listApiKeysForTenant(tenantId);

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">引擎密钥（BYOK）</h1>
          <p className="text-sm text-muted-foreground">
            所有密钥以 AES-256-GCM 加密存储，明文仅在调用 LLM 时短暂解密。UI 永远不会回显完整密钥。
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">添加密钥</CardTitle>
              <CardDescription>
                选择 provider 并粘贴 API key。HTTPS 传输，服务端立即加密。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ApiKeyForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">已保存的密钥</CardTitle>
              <CardDescription>
                共 <span className="font-mono">{keys.length}</span> 个 · 仅显示末四位
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {keys.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  暂无密钥。添加一个开始使用。
                </p>
              ) : (
                <ApiKeyList keys={keys} />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
