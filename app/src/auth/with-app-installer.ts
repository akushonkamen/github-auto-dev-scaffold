import "server-only";
import { signAppJwt } from "@/lib/github-app-jwt";

const INSTALLATION_URL = "https://github.com/apps/gitautodev/installations/new";

interface Installation {
  id: number;
  account: { login: string; type: string };
}

/** In-memory cache for installation tokens (S11: ≤ 50 min). */
const tokenCache = new Map<number, { token: string; expiresAt: number }>();

/**
 * List GitHub App installations accessible to the authenticated user.
 * Uses the user's OAuth access token (not a GitHub App JWT).
 */
export async function getAppInstallationsForUser(
  accessToken: string,
): Promise<Installation[]> {
  const res = await fetch(
    "https://api.github.com/user/installations",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "GithubAutoDev",
      },
    },
  );
  if (!res.ok) {
    throw new Error(
      `GitHub API error (GET /user/installations): ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as { installations: Installation[] };
  return data.installations;
}

/**
 * Get an installation access token for the given installation ID.
 * Caches the token for up to 50 minutes (S11 — never exceed 50 min TTL).
 */
export async function getAppInstallationToken(
  installationId: number,
): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const jwt = await signAppJwt();
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "GithubAutoDev",
      },
    },
  );
  if (!res.ok) {
    throw new Error(
      `GitHub API error (POST /app/installations/${installationId}/access_tokens): ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as { token: string; expires_at: string };

  // Cache for 50 minutes minus a small safety margin (S11)
  const ttlMs = 50 * 60 * 1000;
  tokenCache.set(installationId, {
    token: data.token,
    expiresAt: Date.now() + ttlMs,
  });

  return data.token;
}

export { INSTALLATION_URL };
