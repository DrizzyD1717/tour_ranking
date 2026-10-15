"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { hasSupabase, listMyTournaments, type TournamentSummary } from "@/lib/supabase";
import { useUser } from "@/lib/use-user";
import TournamentBrowser from "@/app/components/TournamentBrowser";

// Runs in the browser on purpose: the session lives in browser storage, so the server can't see whose list this is.
export default function MyTournamentsPage() {
  const { user, loading } = useUser();
  const userId = user?.id;
  const [result, setResult] = useState<{ id: string; list: TournamentSummary[] | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!hasSupabase || !userId) return;
    let active = true;
    listMyTournaments(userId)
      .then((list) => active && setResult({ id: userId, list, error: null }))
      .catch((e) => active && setResult({ id: userId, list: null, error: e instanceof Error ? e.message : "Unknown error" }));
    return () => {
      active = false;
    };
  }, [userId]);

  const mine = result && result.id === userId ? result : null;

  return (
    <main className="bg-floodlight min-h-[calc(100dvh-3.5rem)] px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-7xl">My tournaments</h1>
        <p className="mt-3 max-w-xl text-muted">
          Everything you organize or score, including private and link-only tournaments.
        </p>

        <div className="mt-8">
          {!hasSupabase ? (
            <p className="rounded-xl border border-border bg-surface px-4 py-3 text-muted">Supabase isn&apos;t connected yet.</p>
          ) : loading || (user && !mine) ? (
            <div aria-busy="true" aria-label="Loading your tournaments" className="space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="skeleton h-[5.5rem] rounded-2xl" />
              ))}
            </div>
          ) : !user ? (
            <div className="rounded-2xl border border-border bg-surface p-6">
              <p className="text-lg font-medium">Sign in to see your tournaments.</p>
              <Link
                href="/auth?next=/my-tournaments"
                className="mt-5 inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:shadow-glow-lime"
              >
                Sign in
              </Link>
            </div>
          ) : mine?.error ? (
            <p role="alert" className="rounded-xl border border-loss/40 bg-loss/10 px-4 py-3 text-loss">
              Couldn&apos;t load your tournaments: {mine.error}
            </p>
          ) : (
            <TournamentBrowser
              tournaments={mine?.list ?? []}
              emptyText="You aren't running any tournaments yet. Start one and it will show up here."
            />
          )}
        </div>
      </div>
    </main>
  );
}
