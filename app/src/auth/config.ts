import "server-only";
import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

import { buildProxyAgent } from "./proxy-agent";

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const proxyAgent = proxyUrl ? buildProxyAgent(proxyUrl) : undefined;

/**
 * Explicit cookie overrides.
 *
 * NextAuth's default state/callback cookies can be dropped by Safari ITP and
 * by Chrome when the dev URL is accessed across ports (3000/3001). Pinning
 * SameSite=Lax + Secure=false (HTTP localhost is a secure context in modern
 * Chrome) makes the OAuth callback reliably receive its `state` cookie.
 *
 * In production these are still fine — Lax covers the cross-site redirect
 * from github.com back to our callback.
 */
const isProd = process.env.NODE_ENV === "production" && !process.env.VERCEL_URL?.includes("localhost");
const cookieOptions = {
  sameSite: "lax" as const,
  path: "/",
  secure: isProd,
  httpOnly: true,
};

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.APP_CLIENT_ID!,
      clientSecret: process.env.APP_CLIENT_SECRET!,
      // GitHub App OAuth: scope IS honoured even though GitHub's docs are
      // ambiguous on this. `repo` alone does NOT cover Actions secrets/vars
      // endpoints — those 403 with "Resource not accessible by integration"
      // for installation tokens and for user tokens lacking `workflow`.
      // `workflow` is required for actions/variables + actions/secrets +
      // pushing .github/workflows/*.yml.
      authorization: { params: { scope: "repo workflow read:org" } },
      // openid-client honours httpOptions.agent for all GitHub token/userinfo
      // calls. Without this, dev behind a local proxy (星驰加速 on 17570) times
      // out at github.com/login/oauth/access_token.
      ...(proxyAgent ? { httpOptions: { agent: proxyAgent } } : {}),
    }),
  ],
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
  cookies: {
    // Cookie names use no security prefix because dev runs on HTTP localhost
    // (`__Host-` / `__Secure-` prefixes would be rejected by the browser
    // when Secure=false). In production behind HTTPS we toggle secure=true
    // via the env-driven cookieOptions below.
    pkceCodeVerifier: { name: `next-auth.pkce.code-verifier`, options: cookieOptions },
    callbackUrl: { name: `next-auth.callback-url`, options: cookieOptions },
    csrfToken: { name: `next-auth.csrf-token`, options: cookieOptions },
    sessionToken: { name: `next-auth.session-token`, options: cookieOptions },
    state: { name: `next-auth.state`, options: cookieOptions },
    nonce: { name: `next-auth.nonce`, options: cookieOptions },
  },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      if (profile) {
        const p = profile as { id?: number; login?: string };
        if (typeof p.id === "number") token.githubId = p.id;
        if (typeof p.login === "string") token.githubLogin = p.login;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      if (session.user && token.githubId) {
        (session.user as Record<string, unknown>).githubId = token.githubId;
      }
      if (session.user && token.githubLogin) {
        (session.user as Record<string, unknown>).githubLogin = token.githubLogin;
      }
      return session;
    },
  },
};
