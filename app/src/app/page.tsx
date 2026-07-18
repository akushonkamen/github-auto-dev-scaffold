import Link from "next/link";
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
      <Button size="lg" asChild>
        <Link href="/login">Sign in with GitHub</Link>
      </Button>
    </main>
  );
}
