import "server-only";
import { Client } from "@upstash/qstash";

/**
 * Upstash QStash client (PRD §8 R6 — Vercel function timeout mitigation).
 *
 * The webhook route (`/api/webhook/github`) does just enough work to
 * acknowledge GitHub (verify → dedup → enqueue) and returns 200 within
 * a few hundred ms. A separate worker (Issue #5) consumes the QStash
 * topic and performs the slow operations: installation_token minting,
 * workflow_dispatch, Postgres writes.
 *
 * QSTASH_URL / QSTASH_TOKEN come from Upstash console. Build must NOT
 * fail when they're unset (preview deploys, CI), so we lazily construct
 * the client on first use — callers handle the throw.
 */
let cachedClient: Client | null = null;

export function getQStashClient(): Client {
  if (cachedClient) return cachedClient;
  const url = process.env.QSTASH_URL;
  const token = process.env.QSTASH_TOKEN;
  if (!url || !token) {
    throw new Error(
      "QSTASH_URL / QSTASH_TOKEN are not configured — set them in Vercel env",
    );
  }
  cachedClient = new Client({ baseUrl: url, token });
  return cachedClient;
}

/**
 * Enqueue an async webhook event for worker consumption (Issue #5).
 *
 * @param eventKey  Action-aware key from `asyncEventKey` (e.g. `issues.opened`)
 * @param payload   Raw GitHub event payload (already verified)
 */
export async function enqueueAsyncEvent(
  eventKey: string,
  payload: unknown,
): Promise<{ messageId: string }> {
  const client = getQStashClient();
  // The destination is the same Next.js app, deployed on Vercel. Issue #5
  // wires the worker route `/api/webhook/github/worker`.
  const destination = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/webhook/github/worker`;
  const res = await client.publishJSON({
    url: destination,
    body: { event: eventKey, payload },
  });
  return { messageId: res.messageId };
}
