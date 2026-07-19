import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { AlertCircle, ArrowUpRight, Plus } from "lucide-react";

import { authOptions } from "@/auth/config";
import {
  INSTALLATION_URL,
  getAppInstallationsForUser,
} from "@/auth/with-app-installer";
import { findInstallationByGithubId } from "@/lib/installations-queries";
import { getActiveInstallationDbId } from "@/lib/active-installation";
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

interface GithubInstallation {
  id: number;
  account: { login: string; type: string };
}

interface EnrichedRow {
  github: GithubInstallation;
  dbId: number | null;
  repoFullName: string | null;
  installedAt: Date | null;
  runsCount: number;
  isActive: boolean;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/dashboard");

  const githubLogin = (session.user as Record<string, unknown>).githubLogin as
    | string
    | undefined;

  let installations: GithubInstallation[] = [];
  let installationsError = false;
  if (session.accessToken) {
    try {
      installations = await getAppInstallationsForUser(session.accessToken);
    } catch {
      installationsError = true;
    }
  }

  const activeDbId = await getActiveInstallationDbId();

  const rows: EnrichedRow[] = [];
  for (const inst of installations) {
    const meta = await findInstallationByGithubId(inst.id).catch(() => null);
    rows.push({
      github: inst,
      dbId: meta?.id ?? null,
      repoFullName: meta?.repoFullName ?? null,
      installedAt: meta?.installedAt ?? null,
      runsCount: meta?.runsCount ?? 0,
      isActive: meta?.id != null && meta.id === activeDbId,
    });
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-8">
        {/* Page header */}
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            欢迎，<span className="font-medium text-foreground">{githubLogin ?? session.user.name ?? "User"}</span>。管理你的 GitHub App 安装与运行。
          </p>
        </header>

        {/* Installations */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">
                App Installations · <span className="font-mono text-foreground">{rows.length}</span>
              </h2>
            </div>
            <Button asChild size="sm" variant="outline">
              <a href={INSTALLATION_URL}>
                <Plus className="h-4 w-4" />
                添加安装
              </a>
            </Button>
          </div>

          {installationsError ? (
            <Card className="border-destructive/40">
              <CardContent className="flex items-start gap-3 p-4 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
                <div>
                  无法从 GitHub 加载安装列表。
                  请到 <Link href="/login" className="underline underline-offset-2">/login</Link> 重新连接。
                </div>
              </CardContent>
            </Card>
          ) : rows.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-3 p-12 text-center">
                <div className="rounded-full border bg-muted p-3 text-muted-foreground">
                  <Plus className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">还没有 GitHub App 安装</p>
                  <p className="text-xs text-muted-foreground">
                    把 GitAutoDev App 安装到你的仓库以开始使用。
                  </p>
                </div>
                <Button asChild size="sm">
                  <a href={INSTALLATION_URL}>
                    <Plus className="h-4 w-4" />
                    添加安装
                  </a>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {rows.map((row) => {
                const target =
                  row.dbId != null ? `/dashboard/installations/${row.dbId}` : null;
                const inner = (
                  <Card
                    className={
                      "h-full transition-colors " +
                      (row.isActive
                        ? "border-primary/50 ring-1 ring-primary/30"
                        : "hover:border-foreground/20")
                    }
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <span className="truncate font-mono">
                              {row.github.account.login}
                            </span>
                          </CardTitle>
                          <CardDescription className="flex items-center gap-2">
                            <Badge variant="outline" className="font-normal">
                              {row.github.account.type}
                            </Badge>
                            {row.isActive && (
                              <Badge variant="success" className="gap-1">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                                Active
                              </Badge>
                            )}
                          </CardDescription>
                        </div>
                        {target && (
                          <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="truncate text-sm text-muted-foreground">
                        {row.repoFullName ? (
                          <span className="font-mono">{row.repoFullName}</span>
                        ) : (
                          <span className="italic">
                            Webhook pending — 安装事件未到达
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                        <span>
                          <span className="font-mono text-foreground">
                            {row.runsCount.toLocaleString()}
                          </span>{" "}
                          runs
                        </span>
                        {row.installedAt && (
                          <span>installed {fmtDate(row.installedAt)}</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
                return (
                  <li key={row.github.id} className="h-full">
                    {target ? (
                      <Link href={target} className="block h-full">
                        {inner}
                      </Link>
                    ) : (
                      <div className="h-full opacity-70">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
