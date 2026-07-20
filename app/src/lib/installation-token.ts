import "server-only";
import { signAppJwt } from "@/lib/github-app-jwt";

/**
 * Mint a GitHub installation token (PRD §6 R3 — short-lived, scoped).
 *
 * GitHub installation tokens expire after 1 hour. We cache for 50 minutes in
 * memory per installation_id to avoid the mint round-trip on every dispatch.
 * The cache is a simple Map — Vercel serverless instances are short-lived
 * enough that we don't need LRU/TTL machinery; the worst case is one extra
 * mint per cold start.
 *
 * Caller responsibilities (PRD §7 S4):
 *  - Never log `token.token` — only return it from this function.
 *  - Pass the token as `Authorization: token <tok>` to api.github.com.
 */
type CachedToken = {
  token: string;
  expiresAt: number; // epoch ms
};

const cache = new Map<number, CachedToken>();
const CACHE_TTL_MS = 50 * 60 * 1000; // 50 minutes (token TTL is 60)

export async function getInstallationToken(
  installationId: number,
): Promise<string> {
  const now = Date.now();
  const cached = cache.get(installationId);
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.token;
  }

  const appJwt = await signAppJwt();
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${appJwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) {
    throw new Error(
      `installation token mint failed: status=${res.status}`,
    );
  }
  const json = (await res.json()) as { token: string; expires_at: string };
  cache.set(installationId, {
    token: json.token,
    expiresAt: Date.parse(json.expires_at),
  });
  return json.token;
}

/**
 * Test-only: invalidate cache for an installation. Used by unit tests; never
 * call from request path.
 */
export function _clearTokenCache(installationId?: number): void {
  if (installationId === undefined) cache.clear();
  else cache.delete(installationId);
}
