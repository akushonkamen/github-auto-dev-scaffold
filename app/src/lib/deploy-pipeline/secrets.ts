import "server-only";
import sodium from "libsodium-wrappers";
import type { RepoRef } from "./types";

const API = "https://api.github.com";

let sodiumReady: Promise<void> | null = null;

async function ensureSodium(): Promise<void> {
  if (!sodiumReady) {
    sodiumReady = sodium.ready;
  }
  await sodiumReady;
}

/**
 * Encrypt a secret value with the repo's public key using libsodium
 * sealed-box (GitHub's required scheme). Returns base64 ciphertext.
 *
 * Plaintext never logged (S4).
 */
export async function encryptSecret(
  plaintext: string,
  publicKeyBase64: string,
): Promise<string> {
  await ensureSodium();
  const publicKey = sodium.from_base64(
    publicKeyBase64,
    sodium.base64_variants.ORIGINAL,
  );
  const message = sodium.from_string(plaintext);
  const sealed = sodium.crypto_box_seal(message, publicKey);
  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
}

async function fetchPublicKey(
  repo: RepoRef,
  token: string,
): Promise<{ keyId: string; key: string }> {
  const res = await fetch(
    `${API}/repos/${repo.owner}/${repo.repo}/actions/secrets/public-key`,
    { headers: gh(token) },
  );
  if (!res.ok) {
    throw new Error(`fetchPublicKey HTTP ${res.status}`);
  }
  const data = (await res.json()) as { key_id: string; key: string };
  return { keyId: data.key_id, key: data.key };
}

export async function putSecret(
  repo: RepoRef,
  name: string,
  plaintext: string,
  token: string,
): Promise<{ outcome: "created" | "updated"; message?: string } | { outcome: "failed"; message: string }> {
  const { keyId, key } = await fetchPublicKey(repo, token);
  const encrypted = await encryptSecret(plaintext, key);
  const res = await fetch(
    `${API}/repos/${repo.owner}/${repo.repo}/actions/secrets/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: gh(token),
      body: JSON.stringify({ encrypted_value: encrypted, key_id: keyId }),
    },
  );
  if (res.status === 201 || res.status === 204) {
    return { outcome: res.status === 201 ? "created" : "updated" };
  }
  return {
    outcome: "failed",
    message: `PUT secret ${name} HTTP ${res.status}: ${(await safeText(res)).slice(0, 160)}`,
  };
}

function gh(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "GithubAutoDev-DeployWizard",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
