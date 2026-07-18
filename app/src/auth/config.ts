import "server-only";
import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.APP_CLIENT_ID!,
      clientSecret: process.env.APP_CLIENT_SECRET!,
      authorization: {
        params: { scope: "read:user user:email repo" },
      },
    }),
  ],
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
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
