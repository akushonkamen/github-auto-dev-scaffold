import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppShellNav, TopNav } from "@/components/app-shell-nav";

export interface AppShellProps {
  children: ReactNode;
  /** 顶栏右侧额外内容（如用户头像） */
  topbarRight?: ReactNode;
}

export function AppShell({ children, topbarRight }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AppShellNav />

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b bg-background/95 px-4 backdrop-blur lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-2 lg:hidden">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <span className="text-xs font-bold">G</span>
              </div>
              <span className="text-sm font-semibold">GitAutoDev</span>
            </Link>
            <TopNav />
          </div>
          <div className="flex items-center gap-2">
            {topbarRight}
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
