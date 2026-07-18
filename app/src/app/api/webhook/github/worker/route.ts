import "server-only";
import { NextResponse } from "next/server";

import { verifyQStashSignature } from "@/lib/qstash-verify";
import { claimDelivery } from "@/lib/redis";
import { getInstallationToken } from "@/lib/installation-token";
import { dispatchWorkflow, eventToWorkflow } from "@/lib/dispatch";
import { upsertRun } from "@/lib/runs";
import { db } from "@/db/client";
import { eq, and, isNull } from "drizzle-orm";
import { installations } from "@/db/schema";

// QStash SDK needs fetch + crypto — Node runtime on Vercel.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * QStash worker — consumes deliveries enqueued by /api/webhook/github.
 *
 * Lifecycle (PRD §6 S10, §8 R6):
 *  1. Read raw body (QStash signature is over raw bytes — never `.json()`).
 *  2. Verify `upstash-signature` with QStash Receiver. Reject → 401.
 *  3. Redis SETNX on `delivery:{delivery_id}` for dedup. Already-seen → 200.
 *  4. Resolve `installation_id` → look up our `installations` row for repo.
 *  5. Mint installation_token (50-minute cache).
 *  6. Map `event` key → workflow file via `eventToWorkflow`.
 *  7. `runs` upsert with status=`dispatching` → call GitHub → `dispatched`.
 *  8. Failure → `runs.status=failed` + 5xx so QStash retries.
 */
export async function POST(request: Request): Promise<Response> {
  const url = request.url;
  const signature = request.headers.get("upstash-signature");
  const deliveryId = request.headers.get("x-github-delivery");

  const rawBody = await request.text();

  const ok = await verifyQStashSignature(rawBody, signature, url);
  if (!ok) {
    return NextResponse.json({ error: "Invalid QStash signature" }, { status: 401 });
  }

  let envelope: { event?: unknown; payload?: unknown };
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  const event = typeof envelope.event === "string" ? envelope.event : null;
  const payload =
    envelope.payload && typeof envelope.payload === "object"
      ? (envelope.payload as Record<string, unknown>)
      : null;
  if (!event || !payload) {
    return NextResponse.json({ error: "Missing event/payload" }, { status: 400 });
  }

  // Dedup: if the same X-GitHub-Delivery was already processed, short-circuit.
  // QStash always carries this header through from /api/webhook/github.
  if (deliveryId) {
    try {
      const firstSeen = await claimDelivery(deliveryId);
      if (!firstSeen) {
        return NextResponse.json({ ok: true, deduped: true, deliveryId });
      }
    } catch (err) {
      // Redis down — fail-closed by retrying (5xx → QStash will redeliver and
      // we'll dedup on the next attempt once Redis recovers).
      console.error("redis dedup failed", {
        deliveryId,
        errorMessage: err instanceof Error ? err.message : "unknown",
      });
      return NextResponse.json(
        { ok: false, retry: true, deliveryId },
        { status: 503 },
      );
    }
  }

  const workflowFile = eventToWorkflow(event);
  if (!workflowFile) {
    // label.created / label.deleted / unknown — observe + ack.
    return NextResponse.json({ ok: true, event, ignored: true });
  }

  const installationGithubId = readNumber(payload.installation, "id");
  if (installationGithubId === undefined) {
    return NextResponse.json(
      { error: "Missing installation.id" },
      { status: 400 },
    );
  }

  // Find our DB row for this installation (must be non-soft-deleted).
  const instRow = await db
    .select({
      id: installations.id,
      repoFullName: installations.repoFullName,
    })
    .from(installations)
    .where(
      and(
        eq(installations.installationId, installationGithubId),
        isNull(installations.uninstalledAt),
      ),
    )
    .limit(1);
  if (!instRow[0]) {
    // No active installation row — likely the App was uninstalled between the
    // webhook enqueue and now. Ack 200 so QStash doesn't retry forever.
    return NextResponse.json({
      ok: true,
      event,
      ignored: true,
      reason: "installation_not_found",
    });
  }

  const issueNumber = readNumber(payload.issue, "number");
  const prNumber = readNumber(payload.pull_request, "number");
  if (issueNumber === undefined && prNumber === undefined) {
    return NextResponse.json({
      ok: true,
      event,
      ignored: true,
      reason: "no_issue_or_pr",
    });
  }

  try {
    await upsertRun({
      installationDbId: instRow[0].id,
      issueNumber: issueNumber ?? 0,
      prNumber,
      currentStage: event,
      status: "dispatching",
    });

    const installationToken = await getInstallationToken(installationGithubId);
    await dispatchWorkflow({
      installationToken,
      repoFullName: instRow[0].repoFullName,
      workflowFile,
      eventKey: event,
      payload,
    });

    await upsertRun({
      installationDbId: instRow[0].id,
      issueNumber: issueNumber ?? 0,
      prNumber,
      currentStage: event,
      status: "dispatched",
    });

    return NextResponse.json({
      ok: true,
      event,
      deliveryId,
      dispatched: workflowFile,
    });
  } catch (err) {
    // Don't print err.message if it might contain a token. We only construct
    // messages from status codes and repo names — both safe.
    console.error("dispatch failed", {
      event,
      deliveryId,
      workflowFile,
      errorMessage: err instanceof Error ? err.message : "unknown",
    });

    await upsertRun({
      installationDbId: instRow[0].id,
      issueNumber: issueNumber ?? 0,
      prNumber,
      currentStage: event,
      status: "failed",
    }).catch(() => undefined);

    // 5xx so QStash retries with exponential backoff (up to 24h).
    return NextResponse.json(
      { ok: false, retry: true, deliveryId },
      { status: 502 },
    );
  }
}

function readNumber(obj: unknown, key: string): number | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" ? v : undefined;
}

// Health check for QStash dashboard.
export async function GET(): Promise<Response> {
  return NextResponse.json({ ok: true });
}
