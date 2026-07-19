"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  KeyRound,
  LayoutDashboard,
  Receipt,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/usage", label: "用量", icon: Activity },
  { href: "/settings/engines", label: "引擎密钥", icon: KeyRound },
  { href: "/settings/billing", label: "订阅", icon: Receipt },
  { href: "/settings", label: "设置", icon: Settings },
];

function isActive(pathname: string, item: NavItem): boolean {
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

export function AppShellNav() {
  const pathname = usePathname() ?? "/";
  return (
    <>
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-card/30 lg:flex">
        <div className="flex h-14 items-center gap-2 border-b px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <span className="text-xs font-bold">G</span>
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold tracking-tight">GitAutoDev</span>
            <span className="text-[10px] text-muted-foreground">Console</span>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground group-hover:text-foreground",
                  )}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-3">
          <a
            href="https://github.com/akushonkamen/github-auto-dev-scaffold"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <span className="font-mono">↗</span> 源码 / GitHub
          </a>
        </div>
      </aside>
    </>
  );
}

export function TopNav() {
  const pathname = usePathname() ?? "/";
  return (
    <>
      <nav className="hidden gap-1 lg:flex">
        {NAV.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <nav className="flex gap-1 overflow-x-auto lg:hidden">
        {NAV.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium",
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
