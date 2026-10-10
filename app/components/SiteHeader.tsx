"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase, hasSupabase } from "@/lib/supabase";
import { useUser } from "@/lib/use-user";

export default function SiteHeader() {
  const { user, loading } = useUser();
  const router = useRouter();

  async function signOut() {
    await getSupabase().auth.signOut();
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="font-display text-2xl font-extrabold tracking-tight">
          Matchday
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          {hasSupabase &&
            !loading &&
            (user ? (
              <button onClick={signOut} className="cursor-pointer rounded-full px-3 py-2 text-muted transition-colors hover:text-foreground">
                Sign out
              </button>
            ) : (
              <Link href="/auth" className="rounded-full px-3 py-2 text-muted transition-colors hover:text-foreground">
                Sign in
              </Link>
            ))}
          <Link
            href="/tournaments/new"
            className="rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground transition hover:shadow-glow-lime"
          >
            <span className="sm:hidden">New</span>
            <span className="hidden sm:inline">Start a tournament</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
