import "server-only";
import { SignJWT, importPKCS8 } from "jose";

let cachedKey: CryptoKey | null = null;

async function getPrivateKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const base64Pem = process.env.APP_PRIVATE_KEY;
  if (!base64Pem) {
    throw new Error("APP_PRIVATE_KEY environment variable is not set");
  }
  const pem = Buffer.from(base64Pem, "base64").toString("utf-8");
  cachedKey = await importPKCS8(pem, "RS256");
  return cachedKey;
}

/**
 * Sign a GitHub App JWT with RS256, 9-minute expiration.
 * @see https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 */
export async function signAppJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const privateKey = await getPrivateKey();
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(process.env.APP_ID!)
    .setIssuedAt(now)
    .setExpirationTime(now + 9 * 60)
    .sign(privateKey);
}
