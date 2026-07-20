import "server-only";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/auth/config";
import { getAppInstallationsForUser } from "@/auth/with-app-installer";
import { findInstallationForRun, findRunInInstallation } from "@/lib/runs-queries";

// SSE must run on Node runtime — Vercel Edge doesn't allow ReadableStream
// keep-alive the way we need for 2-second polling cycles.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 2_000;
const MAX_STREAM_MS = 10 * 60 * 1_000; // 10 min cap per stream
const TERMINAL_STATUSES = new Set(["dispatched", "failed"]);

/**
 * Server-Sent Events endpoint for a single run (Issue #7).
 *
 * Client subscribes via `new EventSource('/api/runs/<runId>/events')`. The
 * server polls Postgres every 2 seconds and sends a `snapshot` event with
 * the current run row. When the run reaches a terminal status, the server
 * sends a final `complete` event and closes the stream.
 *
 * Auth: the session user's GitHub token must still list the installation
 * that owns this run. We check once at stream open; subsequent snapshots
 * only read DB state, never re-mint installation tokens (rate-limit guard).
 * If the user revokes mid-stream, the stream keeps going until terminal —
 * acceptable for v1 since snapshots contain no secrets.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId: runIdStr } = await context.params;
  const runId = Number.parseInt(runIdStr, 10);
  if (!Number.isFinite(runId) || runId <= 0) {
    return NextResponse.json({ error: "Invalid runId" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const inst = await findInstallationForRun(runId);
  if (!inst) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (!session.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let authorized = false;
  try {
    const accessible = await getAppInstallationsForUser(session.accessToken);
    authorized = accessible.some((i) => i.id === inst.installationGithubId);
  } catch {
    authorized = false;
  }
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      let lastSnapshot = "";

      const send = (event: string, data: unknown) => {
        const payload =
          `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      // Initial hello so the client knows the stream is alive even before
      // the first poll completes.
      send("ready", { runId, polledAt: new Date().toISOString() });

      const poll = async () => {
        if (Date.now() - startedAt > MAX_STREAM_MS) {
          send("timeout", { runId });
          controller.close();
          return;
        }
        const row = await findRunInInstallation(runId, inst.installationDbId);
        if (!row) {
          send("error", { error: "run_not_found" });
          controller.close();
          return;
        }
        const snapshot = JSON.stringify(row);
        if (snapshot !== lastSnapshot) {
          lastSnapshot = snapshot;
          send("snapshot", row);
        }
        if (row.status && TERMINAL_STATUSES.has(row.status)) {
          send("complete", row);
          controller.close();
          return;
        }
        // Clear any prior timer before scheduling — defensive against the
        // micro-gap where abort fires between assignment and next tick.
        if (timer) clearTimeout(timer);
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      };

      let timer: NodeJS.Timeout | null = setTimeout(poll, POLL_INTERVAL_MS);

      // Cleanup when the client disconnects.
      request.signal.addEventListener("abort", () => {
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable proxy buffering (Vercel edge)
    },
  });
}
