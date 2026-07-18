import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-bold tracking-tight">GithubAutoDev</h1>
        <p className="max-w-md text-muted-foreground">
          AI-driven Issue → Merge automation. App v1 scaffold.
        </p>
      </div>
      {/* Sign-in is wired in Issue #3 (next-auth GitHub provider). */}
      <Button size="lg" disabled>
        Sign in with GitHub
      </Button>
    </main>
  );
}
