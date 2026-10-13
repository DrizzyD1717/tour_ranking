import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { hasSupabase, listPublicTournaments, type TournamentSummary } from "@/lib/supabase";
import TournamentBrowser from "./components/TournamentBrowser";

export default function Home() {
  return (
    <main>
      <section className="bg-floodlight relative overflow-hidden border-b border-border">
        <div
          aria-hidden
          className="bg-pitch-grid absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
        />
        <div className="relative mx-auto max-w-5xl px-4 pb-14 pt-16 sm:px-6 sm:pb-20 sm:pt-24">
          <h1 className="max-w-3xl font-display text-6xl font-extrabold leading-[0.9] tracking-tight sm:text-8xl">
            Who&apos;s top of the table?
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            Follow tournaments from faculty games to FIFA nights, or start your own. Enter the scores and everyone
            watching sees the table move.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/tournaments/new"
              className="inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:shadow-glow-lime"
            >
              Start a tournament
            </Link>
            <Link
              href="/tournaments/demo"
              className="inline-flex rounded-full border border-border-strong px-6 py-3 font-semibold transition hover:border-foreground"
            >
              Demo league
            </Link>
            <Link
              href="/tournaments/demo-knockout"
              className="inline-flex rounded-full border border-border-strong px-6 py-3 font-semibold transition hover:border-foreground"
            >
              Demo knockout
            </Link>
            <Link
              href="/tournaments/demo-groups"
              className="inline-flex rounded-full border border-border-strong px-6 py-3 font-semibold transition hover:border-foreground"
            >
              Demo groups
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14" aria-label="Tournaments">
        <Suspense fallback={<ListSkeleton />}>
          <Tournaments />
        </Suspense>
      </section>
    </main>
  );
}

// The list is read at request time, so it streams in behind a loading state (required with cacheComponents).
async function Tournaments() {
  await connection();

  if (!hasSupabase) {
    return (
      <TournamentBrowser
        tournaments={[]}
        notice="Supabase isn't connected yet, so no tournaments can be listed. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local and restart the dev server."
      />
    );
  }

  let tournaments: TournamentSummary[];
  try {
    tournaments = await listPublicTournaments();
  } catch (e) {
    return (
      <p role="alert" className="rounded-xl border border-loss/40 bg-loss/10 px-4 py-3 text-loss">
        Couldn&apos;t load tournaments: {e instanceof Error ? e.message : "unknown error"}. Check your Supabase URL and
        key, and that schema.sql ran in full.
      </p>
    );
  }
  return <TournamentBrowser tournaments={tournaments} />;
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading tournaments" className="space-y-3">
      <div className="skeleton h-9 w-72 rounded-full" />
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="skeleton h-[5.5rem] rounded-2xl" />
      ))}
    </div>
  );
}
