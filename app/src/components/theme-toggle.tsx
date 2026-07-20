"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="切换主题"
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-foreground transition-colors hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {resolved === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
