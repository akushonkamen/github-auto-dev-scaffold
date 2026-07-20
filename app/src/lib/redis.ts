import "server-only";
import { Redis } from "@upstash/redis";

/**
 * Upstash Redis client (PRD §6 — webhook dedup by X-GitHub-Delivery).
 *
 * QStash will retry on non-2xx, and GitHub redeliveries can land twice for
 * the same `X-GitHub-Delivery`. We use `SET ... NX EX 86400` to ensure one
 * delivery is processed exactly once per 24h window.
 *
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN come from the Upstash
 * console. Lazy construct so preview deploys without Redis still build.
 */
let cachedClient: Redis | null = null;

export function getRedis(): Redis {
  if (cachedClient) return cachedClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not configured",
    );
  }
  cachedClient = new Redis({ url, token });
  return cachedClient;
}

/**
 * Returns `true` if this caller won the SETNX race (i.e. the key was newly set
 * and this delivery should be processed). Returns `false` if a prior delivery
 * already claimed the key — caller should ack 200 without doing work.
 */
export async function claimDelivery(
  deliveryId: string,
): Promise<boolean> {
  const redis = getRedis();
  // SET key 1 NX EX 86400 — Upstash returns "OK" on success, null if key exists.
  const result = await redis.set(`delivery:${deliveryId}`, "1", {
    nx: true,
    ex: 86400,
  });
  return result === "OK";
}
