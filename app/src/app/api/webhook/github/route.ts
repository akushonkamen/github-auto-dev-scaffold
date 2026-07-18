import "server-only";
import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

import { verifyGitHubWebhookSignature } from "@/lib/webhook-verify";
import {
  asyncEventKey,
  isAsyncEvent,
  isSyncEvent,
} from "@/lib/github-events";
import { enqueueAsyncEvent } from "@/lib/qstash";
import {
  softDeleteInstallationFromEvent,
  upsertInstallationFromEvent,
} from "@/lib/installations";

// Force the Node runtime — `crypto.createHmac` requires it and QStash
// SDK needs fetch (only available in the Node runtime on Vercel by default).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lazy Redis client for webhook dedup. Build / typecheck must succeed
// without UPSTASH_REDIS env vars (CI, preview deploys), so we construct it
// on first use and cache the error if missing — the route handles gracefully.
let redisClient: Redis | null = null;
let redisMissing = false;

function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  if (redisMissing) return null;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    redisMissing = true;
    return null;
  }
  redisClient = new Redis({ url, token });
  return redisClient;
}

/**
 * Try to claim this delivery ID as processed. Returns `true` if this is
 * the first claim (SETNX succeeded), `false` if already processed.
 * When Redis is unavailable, returns `true` (allow through — at-least-once
 * delivery is safer than dropping events).
 */
async function tryClaimDelivery(
  deliveryId: string,
): Promise<boolean | "dedup"> {
  try {
    const r = getRedis();
    if (!r) return true; // Redis not configured — pass through
    // SETNX: 1 if key was set, 0 if already exists
    const claimed = await r.setnx(
      `webhook:delivery:${deliveryId}`,
      "1",
    );
    if (claimed === 0) return "dedup";
    // 24-hour TTL so the key self-cleans
    await r.expire(`webhook:delivery:${deliveryId}`, 86_400);
    return true;
  } catch {
    // Redis transient error — allow through rather than dropping events
    return true;
  }
}

/**
 * GitHub webhook entrypoint.
 *
 * Lifecycle (PRD §6 S10, §8 R6):
 *  1. Read raw body as text (NEVER `.json()` — signature is over raw bytes).
 *  2. Verify X-Hub-Signature-256 with timingSafeEqual. Reject → 401.
 *  3. Dedup via X-GitHub-Delivery (Upstash Redis SETNX + TTL 24h).
 *  4. Route:
 *     - installation / installation_repositories → sync upsert (Postgres)
 *     - issues / pull_request / label / issue_comment → QStash enqueue
 *     - everything else → 200 `{ ignored: true }`
 *
 * S4: never log secrets, raw headers, or token values. The 500 fallback
 * does NOT print the error message — it might contain secret material.
 */
export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("X-Hub-Signature-256");
  const event = request.headers.get("X-GitHub-Event");
  const deliveryId = request.headers.get("X-GitHub-Delivery");
  const secret = process.env.WEBHOOK_SECRET;

  if (!secret) {
    // Missing server-side config — fail loudly to Vercel logs but
    // return 500 (do NOT leak that the secret is unset to GitHub).
    console.error("WEBHOOK_SECRET env var is not set");
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 },
    );
  }

  // No streaming — we need the bytes twice (verify + parse).
  const rawBody = await request.text();

  if (!verifyGitHubWebhookSignature(rawBody, signature, secret)) {
    // 401 (not 403) so GitHub's webhook UI surfaces the failure clearly.
    // Do NOT echo the signature header back (S4).
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!event) {
    return NextResponse.json({ error: "Missing event header" }, { status: 400 });
  }

  // ── Dedup: claim this delivery ID ────────────────────────────────
  if (deliveryId) {
    const claimed = await tryClaimDelivery(deliveryId);
    if (claimed === "dedup") {
      // Already processed this delivery — ack 200 + signal so callers
      // can observe the dedup (but do NOT log it per S4).
      return NextResponse.json({
        ok: true,
        event,
        deliveryId,
        dedup: true,
      });
    }
  }

  // Parse only after verification succeeds — avoids wasting cycles on
  // spoofed bodies.
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  // ── SYNC lane: installation lifecycle ──────────────────────────────
  if (isSyncEvent(event)) {
    try {
      const action = readAction(payload);
      if (event === "installation") {
        if (action === "created" || action === "new_permissions_accepted") {
          await upsertInstallationFromEvent(
            payload as Parameters<typeof upsertInstallationFromEvent>[0],
          );
        } else if (action === "deleted") {
          await softDeleteInstallationFromEvent(
            payload as Parameters<typeof softDeleteInstallationFromEvent>[0],
          );
        }
      }
      if (event === "installation_repositories") {
        if (action === "added") {
          await upsertInstallationFromEvent(
            payload as Parameters<typeof upsertInstallationFromEvent>[0],
          );
        } else if (action === "removed") {
          await softDeleteInstallationFromEvent(
            payload as Parameters<typeof softDeleteInstallationFromEvent>[0],
          );
        }
      }
    } catch (err) {
      // Sync failures are reported but do not 500 to GitHub — a retry
      // storm would just replay the same Postgres failure.
      console.error("installation sync handler failed", {
        event,
        deliveryId,
        // err.message is safe to log here because GitHub webhook bodies
        // for installation events do not carry user-supplied secrets.
        errorMessage: err instanceof Error ? err.message : "unknown",
      });
      return NextResponse.json(
        { ok: false, syncError: true, deliveryId },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true, event, deliveryId, sync: true });
  }

  // ── ASYNC lane: queue for the worker (Issue #5) ────────────────────
  if (isAsyncEvent(event)) {
    const action = readAction(payload);
    const eventKey = asyncEventKey(event, action);
    if (!eventKey) {
      return NextResponse.json({
        ok: true,
        event,
        deliveryId,
        ignored: true,
      });
    }
    try {
      const { messageId } = await enqueueAsyncEvent(eventKey, payload);
      return NextResponse.json({
        ok: true,
        event,
        deliveryId,
        queued: 1,
        messageId,
      });
    } catch (err) {
      // QStash down / misconfigured — surface to Vercel logs, but
      // ack 200 to GitHub so we don't get a retry storm. The replay
      // will need to come from re-emitting the event manually.
      console.error("qstash enqueue failed", {
        event,
        deliveryId,
        errorMessage: err instanceof Error ? err.message : "unknown",
      });
      return NextResponse.json(
        { ok: false, queueError: true, deliveryId },
        { status: 200 },
      );
    }
  }

  // Unrecognized event — ack 200 + ignored so GitHub doesn't retry.
  return NextResponse.json({ ok: true, event, deliveryId, ignored: true });
}

function readAction(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const maybeAction = (payload as { action?: unknown }).action;
  return typeof maybeAction === "string" ? maybeAction : undefined;
}

// GitHub retries webhooks on non-2xx. We respond 200 to GET / HEAD so
// the URL shows up as healthy in the GitHub App settings UI.
export async function GET(): Promise<Response> {
  return NextResponse.json({ ok: true });
}
