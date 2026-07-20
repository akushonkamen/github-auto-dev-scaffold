"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowUpRight, Send, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorkPanel } from "./WorkPanel";
import { cn } from "@/lib/utils";

interface Props {
  installationDbId: number;
  repoFullName: string;
}

const CHIPS = [
  { id: "personal", label: "个人小工具" },
  { id: "team", label: "给团队用" },
  { id: "public", label: "对外的网站" },
  { id: "vague", label: "还没想清楚，边聊边定" },
];

interface RunSnapshot {
  id: number;
  issueNumber: number;
  prNumber: number | null;
  currentStage: string | null;
  status: string | null;
}

interface ChatMsg {
  role: "user" | "ai";
  body: string;
  meta?: string;
}

/**
 * /create 工作台主体。双栏：
 *   左 chat (flex-1)        —— 用户与 AI 的对话
 *   右 work panel (460px)   —— 按 stage 切换内容的常驻面板
 *
 * 状态机：
 *   draft        — 还没创建 issue。textarea + chips + "开始造" CTA
 *   post-create  — 已有 runId。chat 接 /comments 拉 AI 消息；
 *                  work panel 接 SSE 跟 stage 推进。
 */
export function CreateWorkspace({ installationDbId, repoFullName }: Props) {
  const [stage, setStage] = useState<"draft" | RunSnapshot>("draft");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [chip, setChip] = useState<string | null>("personal");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [reply, setReply] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);

  const isDraft = stage === "draft";
  const snapshot = !isDraft ? (stage as RunSnapshot) : null;

  // draft → post-create: create issue + run
  const startRun = useCallback(async () => {
    if (!draftTitle.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/runs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationDbId,
          title: draftTitle.trim(),
          body: draftBody.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        runId: number;
        issueNumber: number;
      };
      // The user message mirrors the issue body so they see what was sent.
      setChat([
        { role: "user", body: `**${draftTitle.trim()}**\n\n${draftBody.trim()}` },
      ]);
      setStage({
        id: data.runId,
        issueNumber: data.issueNumber,
        prNumber: null,
        currentStage: "triage",
        status: "queued",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown_error");
    } finally {
      setSubmitting(false);
    }
  }, [draftTitle, draftBody, installationDbId, submitting]);

  // Post-create: subscribe to SSE for stage updates + poll comments.
  useEffect(() => {
    if (isDraft || !snapshot) return;
    const runId = snapshot.id;

    let cancelled = false;

    // Pull AI messages from issue comments.
    const pullComments = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/comments`, {
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          messages: Array<{
            id: number;
            body: string;
            createdAt: string;
          }>;
        };
        const seen = new Set(chat.map((m) => m.meta));
        const fresh: ChatMsg[] = data.messages
          .filter((m) => !seen.has(`bot-${m.id}`))
          .map((m) => ({
            role: "ai" as const,
            body: m.body,
            meta: `bot-${m.id}`,
          }));
        if (fresh.length > 0) {
          setChat((prev) => [...prev, ...fresh]);
        }
      } catch {
        // network errors are non-fatal for chat — SSE keeps stage updates going
      }
    };

    void pullComments();

    // Independent comment-polling interval. The runs-table SSE only fires
    // when webhook worker updates status (dispatched/failed) — it does NOT
    // track stage progression. Without this timer the chat panel stays
    // empty after the initial pull.
    const commentTimer = setInterval(() => {
      if (!cancelled) void pullComments();
    }, 5_000);

    const es = new EventSource(`/api/runs/${runId}/events`, {
      withCredentials: true,
    });
    es.addEventListener("snapshot", (ev) => {
      try {
        const data = JSON.parse(
          (ev as MessageEvent).data,
        ) as Partial<RunSnapshot>;
        if (cancelled) return;
        setStage((prev) =>
          prev === "draft"
            ? prev
            : { ...(prev as RunSnapshot), ...data },
        );
        void pullComments();
      } catch {
        // ignore malformed payload
      }
    });
    es.addEventListener("complete", (ev) => {
      try {
        const data = JSON.parse(
          (ev as MessageEvent).data,
        ) as Partial<RunSnapshot>;
        if (cancelled) return;
        setStage((prev) =>
          prev === "draft" ? prev : { ...(prev as RunSnapshot), ...data },
        );
      } catch {
        // ignore
      }
      es.close();
    });
    es.addEventListener("error", () => {
      // SSE auto-reconnect handles transient drops.
    });

    return () => {
      cancelled = true;
      clearInterval(commentTimer);
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraft, snapshot?.id]);

  // Auto-scroll chat on new message.
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [chat.length]);

  const replyDisabled = isDraft || !reply.trim();

  async function postReply() {
    if (replyDisabled || !snapshot) return;
    // User replies go to GitHub Issue comments via the comments endpoint's
    // sibling POST (v2.1). For v2.0 we mirror locally so the chat feels
    // responsive; the dispatch on issue_comment.created will fire regardless
    // when the user posts via GitHub UI.
    setChat((prev) => [...prev, { role: "user", body: reply.trim() }]);
    setReply("");
  }

  const pill = !snapshot
    ? null
    : snapshot.status === "queued" || snapshot.status === "dispatched"
      ? { text: "AI 在干活", cls: "bg-work-soft text-work" }
      : snapshot.status === "in-review"
        ? { text: "等你验收", cls: "bg-you-soft text-you" }
        : snapshot.status === "merged"
          ? { text: "已上线", cls: "bg-success/15 text-success" }
          : snapshot.status === "failed"
            ? { text: "出错了", cls: "bg-fail-soft text-fail" }
            : { text: "需要回复", cls: "bg-you-soft text-you" };

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-[1400px] flex-col px-4 pb-4 sm:px-6">
      {/* 顶部状态条 */}
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-7 items-center gap-1.5 rounded-full bg-work/10 px-2.5 text-xs font-medium text-work">
            <Sparkles className="h-3 w-3" />
            造物
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            {repoFullName}
          </div>
          {snapshot && (
            <Badge variant="outline" className="font-mono text-xs">
              <Link
                href={`https://github.com/${repoFullName}/issues/${snapshot.issueNumber}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-work"
              >
                #{snapshot.issueNumber}
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </Badge>
          )}
        </div>
        {pill && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold",
              pill.cls,
            )}
          >
            {pill.text.includes("干活") && (
              <span className="h-1.5 w-1.5 animate-omc-blink rounded-full bg-current" />
            )}
            {pill.text}
          </span>
        )}
      </header>

      {/* 双栏 grid */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_460px]">
        {/* 左：聊天区 */}
        <section className="flex min-h-0 flex-col rounded-xl border bg-card shadow-[0_1px_3px_rgba(29,42,50,0.05)]">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h2 className="font-serif text-base font-bold text-ink">
              {isDraft ? "你想造一个什么？" : "对话"}
            </h2>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {isDraft ? "draft" : `stage:${snapshot?.currentStage ?? "?"}`}
            </span>
          </div>

          {/* 消息列表 / draft 占位 */}
          <div ref={messagesRef} className="flex-1 overflow-y-auto p-5">
            {isDraft ? (
              <DraftIntake
                title={draftTitle}
                body={draftBody}
                chip={chip}
                onTitle={setDraftTitle}
                onBody={setDraftBody}
                onChip={setChip}
              />
            ) : (
              <div className="flex flex-col gap-3.5">
                {chat.map((m, i) => (
                  <ChatBubble key={i} msg={m} />
                ))}
                {chat.length === 0 && (
                  <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                    AI 即将响应，请稍候…
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 输入区 */}
          <div className="border-t p-4">
            {error && (
              <div className="mb-2 flex items-center gap-2 rounded-md bg-fail-soft px-3 py-2 text-xs text-fail">
                <AlertCircle className="h-3.5 w-3.5" />
                {error}
              </div>
            )}
            {isDraft ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  {draftTitle.trim()
                    ? `${draftTitle.trim().length} 字标题已就绪`
                    : "先写一句话标题，开干再说"}
                </span>
                <Button
                  onClick={startRun}
                  disabled={!draftTitle.trim() || submitting}
                  className="bg-work text-white hover:bg-work/90"
                >
                  {submitting ? "创建中…" : "开始造"}
                </Button>
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="补充需求或回答 AI 的问题…"
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void postReply();
                    }
                  }}
                  className="flex-1 resize-none rounded-md border border-input bg-cream/30 px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-you"
                />
                <Button
                  onClick={postReply}
                  disabled={replyDisabled}
                  size="icon"
                  aria-label="发送"
                  className="bg-you text-white hover:bg-you/90"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </section>

        {/* 右：工作面板 */}
        <aside className="min-h-0 overflow-y-auto rounded-xl border bg-card shadow-[0_1px_3px_rgba(29,42,50,0.05)]">
          <WorkPanel
            stage={stage}
            repoFullName={repoFullName}
            installationDbId={installationDbId}
          />
        </aside>
      </div>
    </div>
  );
}

function DraftIntake(props: {
  title: string;
  body: string;
  chip: string | null;
  onTitle: (v: string) => void;
  onBody: (v: string) => void;
  onChip: (id: string | null) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 flex items-center gap-2 text-sm font-bold">
          <span className="rounded-md bg-work-soft px-2 py-0.5 font-mono text-[11px] text-work">
            标题
          </span>
          一句话总结
        </label>
        <input
          value={props.title}
          onChange={(e) => props.onTitle(e.target.value)}
          placeholder="比如：内部周报机器人"
          className="w-full rounded-md border border-input bg-cream/30 px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-work"
        />
      </div>
      <div>
        <label className="mb-1.5 flex items-center gap-2 text-sm font-bold">
          <span className="rounded-md bg-work-soft px-2 py-0.5 font-mono text-[11px] text-work">
            详情
          </span>
          描述功能 / 期望（可选）
        </label>
        <textarea
          value={props.body}
          onChange={(e) => props.onBody(e.target.value)}
          placeholder="比如：每周五从 GitHub PR 汇总贡献，推送到飞书群，PR 标题翻译成中文…"
          rows={5}
          className="w-full resize-y rounded-md border border-input bg-cream/30 px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-work"
        />
      </div>
      <div>
        <div className="mb-2 text-sm font-bold">类型</div>
        <div className="flex flex-wrap gap-2">
          {CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => props.onChip(c.id === props.chip ? null : c.id)}
              className={cn(
                "rounded-full border px-4 py-1.5 text-xs font-medium transition-colors",
                props.chip === c.id
                  ? "border-work bg-work-soft text-work"
                  : "border-border bg-card text-foreground hover:border-work/40 hover:text-work",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        点「开始造」会在仓库创建一个 GitHub Issue，AI 自动接手 —
        你可以离开页面，有进展会通知你。
      </p>
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm",
          isUser
            ? "rounded-br-sm bg-ink text-background"
            : "rounded-bl-sm border bg-work-soft/50 text-foreground",
        )}
      >
        {msg.body}
      </div>
    </div>
  );
}
