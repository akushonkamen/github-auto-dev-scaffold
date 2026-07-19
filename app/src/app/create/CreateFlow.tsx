"use client";

import { useState } from "react";
import { ArrowRight, Check, Send, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { BuildRail, type Station } from "@/components/build-rail";
import { cn } from "@/lib/utils";

type Screen = "intake" | "building" | "accept";

const CHIPS = [
  { id: "personal", label: "个人小工具" },
  { id: "team", label: "给团队用" },
  { id: "public", label: "对外的网站" },
  { id: "vague", label: "还没想清楚" },
];

const STATIONS: Station[] = [
  { id: "triage", label: "理解需求", status: "done" },
  { id: "design", label: "设计稿", status: "done" },
  { id: "develop", label: "写代码", status: "now" },
  { id: "verify", label: "自检", status: "pending" },
  { id: "ship", label: "交付", status: "pending" },
];

interface ChatMsg {
  role: "user" | "ai";
  text: string;
}

const MOCK_CHAT: ChatMsg[] = [
  {
    role: "ai",
    text: "明白了 — 你要做一个内部周报机器人，每周五自动从 GitHub PR 收集贡献、汇总成飞书卡片。我从这个版本开始，有问题随时打断我。",
  },
  {
    role: "user",
    text: "对，PR 标题不要英文原文，要翻译成中文",
  },
  {
    role: "ai",
    text: "好的，已加 i18n 步骤。现在写到 develop 阶段，大概 40 秒。",
  },
];

const CHECKLIST = [
  { id: "1", label: "GitHub PR 拉取（最近 7 天）", done: true },
  { id: "2", label: "标题中英翻译", done: true },
  { id: "3", label: "飞书卡片渲染 + 推送", done: true },
  { id: "4", label: "每周五 18:00 定时触发", done: false },
];

export function CreateFlow() {
  const [screen, setScreen] = useState<Screen>("intake");
  const [draft, setDraft] = useState("");
  const [chip, setChip] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header — 全局可见的标题 + 步骤指示 */}
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-work">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-work" />
          造物 · vibecoding
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {screen === "intake" && "你想造一个什么？"}
          {screen === "building" && "正在造…"}
          {screen === "accept" && "造好了，你看看"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {screen === "intake" && "一句话说出你想要的，剩下的我来。"}
          {screen === "building" && "可以随时打断、补充，我会改方向。"}
          {screen === "accept" && "满意就接受，不满意直接说哪儿不对。"}
        </p>
      </header>

      {/* Step pill — 三段式进度 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {([
          ["intake", "1 · 说想法"],
          ["building", "2 · 建造中"],
          ["accept", "3 · 验收"],
        ] as const).map(([key, label]) => {
          const active = screen === key;
          const passed =
            (screen === "building" && key === "intake") ||
            (screen === "accept" && (key === "intake" || key === "building"));
          return (
            <span
              key={key}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium",
                active
                  ? "border-work bg-work/10 text-work"
                  : passed
                    ? "border-work/30 bg-work/5 text-work/80"
                    : "border-border text-muted-foreground",
              )}
            >
              {passed && <Check className="h-3 w-3" />}
              {label}
            </span>
          );
        })}
      </div>

      {/* ===== Screen 1 — Intake ===== */}
      {screen === "intake" && (
        <Card className="border-work/20 bg-cream/40 dark:bg-cream/5">
          <CardContent className="space-y-5 p-6">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="比如：帮我做一个内部周报机器人，每周五从 GitHub PR 汇总贡献推到飞书…"
              rows={4}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-work"
            />
            <div className="flex flex-wrap gap-2">
              {CHIPS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChip(c.id === chip ? null : c.id)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    chip === c.id
                      ? "border-work bg-work/10 text-work"
                      : "border-border bg-background text-muted-foreground hover:border-work/40 hover:text-work",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 pt-2">
              <span className="text-xs text-muted-foreground">
                {draft.trim().length === 0
                  ? "写一句就行，想清楚再写也可以。"
                  : `${draft.trim().length} 字 · 可以开始了`}
              </span>
              <Button
                onClick={() => setScreen("building")}
                disabled={draft.trim().length === 0}
                className="gap-1.5 bg-work text-white hover:bg-work/90"
              >
                开始造
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== Screen 2 — Building ===== */}
      {screen === "building" && (
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <CardContent className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  进度
                </span>
                <Badge variant="info" className="gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                  AI 正在写代码
                </Badge>
              </div>
              <BuildRail stations={STATIONS} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-5">
              {MOCK_CHAT.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex",
                    m.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
                      m.role === "user"
                        ? "bg-ink text-background"
                        : "bg-work-soft text-foreground",
                    )}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex items-center gap-2">
            <input
              placeholder="补充一句，或者直接说「停下」…"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-work"
            />
            <Button variant="outline" size="icon" aria-label="发送">
              <Send className="h-4 w-4" />
            </Button>
            <Button
              onClick={() => setScreen("accept")}
              className="bg-work text-white hover:bg-work/90"
            >
              跳到验收
            </Button>
          </div>
        </div>
      )}

      {/* ===== Screen 3 — Accept ===== */}
      {screen === "accept" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-0">
              {/* Mock browser chrome */}
              <div className="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-fail/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-you/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-work/60" />
                <span className="ml-2 flex-1 truncate rounded-sm bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                  weekly-bot.local/preview
                </span>
              </div>
              <div className="space-y-3 p-5">
                <div className="text-xs font-medium text-muted-foreground">
                  本周贡献 · Week 29
                </div>
                <div className="space-y-2">
                  {[
                    "@akushonkamen — 修复 verify:retry-N 闭环（5 个 PR）",
                    "@codex-bot — review verdict 结构化（3 个 PR）",
                    "@ralph — bridge 进程主密钥（1 个 PR）",
                  ].map((line) => (
                    <div
                      key={line}
                      className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                验收清单
              </div>
              <ul className="space-y-2">
                {CHECKLIST.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border",
                        c.done
                          ? "border-success bg-success text-success-foreground"
                          : "border-border bg-background",
                      )}
                    >
                      {c.done && <Check className="h-3 w-3" />}
                    </span>
                    <span className={cn(!c.done && "text-muted-foreground")}>
                      {c.label}
                    </span>
                  </li>
                ))}
              </ul>
              <Separator />
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="outline" className="gap-1.5">
                  <X className="h-4 w-4" />
                  不对，重做
                </Button>
                <Button className="gap-1.5 bg-success text-success-foreground hover:bg-success/90">
                  <Check className="h-4 w-4" />
                  接受交付
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="text-center">
            <button
              type="button"
              onClick={() => setScreen("intake")}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-work hover:underline"
            >
              ← 再造一个
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
