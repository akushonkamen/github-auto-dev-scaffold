"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Sign in</h1>
        <p className="max-w-md text-muted-foreground">
          Sign in with your GitHub account to use GithubAutoDev.
          This app requests <code>repo</code> scope to manage your repositories.
        </p>
      </div>
      <Button
        size="lg"
        onClick={() => signIn("github", { callbackUrl: "/dashboard" })}
      >
        Sign in with GitHub
      </Button>
    </main>
  );
}
