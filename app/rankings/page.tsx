import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { buildDemoRankingTournaments } from "@/lib/demo";
import { hasSupabase, listRankingTournaments } from "@/lib/supabase";
import { buildRankings, type RankingTournament } from "@/lib/tournament";
import RankingsBoard from "../components/RankingsBoard";

export const metadata: Metadata = { title: "Rankings" };

export default function RankingsPage() {
  return (
    <main>
      <section className="bg-floodlight relative overflow-hidden border-b border-border">
        <div
          aria-hidden
          className="bg-pitch-grid absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
        />
        <div className="relative mx-auto max-w-5xl px-4 pb-10 pt-14 sm:px-6 sm:pb-14 sm:pt-20">
          <h1 className="font-display text-6xl font-extrabold leading-[0.9] tracking-tight sm:text-8xl">All-time rankings</h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Every public tournament, added up. See who has won the most, game by game.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <Suspense fallback={<Skeleton />}>
          <Rankings />
        </Suspense>
      </section>
    </main>
  );
}

// Read at request time, so it streams in behind a loading state (required with cacheComponents).
async function Rankings() {
  await connection();

  let tournaments: RankingTournament[];
  let notice: string | undefined;
  if (!hasSupabase) {
    tournaments = buildDemoRankingTournaments();
    notice = "Supabase isn't connected yet, so this is demo data. Add your Supabase keys to .env.local to see real rankings.";
  } else {
    try {
      tournaments = await listRankingTournaments();
    } catch (e) {
      return (
        <p role="alert" className="rounded-xl border border-loss/40 bg-loss/10 px-4 py-3 text-loss">
          Couldn&apos;t load rankings: {e instanceof Error ? e.message : "unknown error"}. Check that schema.sql and the
          migrations ran in full.
        </p>
      );
    }
  }

  const { games, champions } = buildRankings(tournaments);
  return <RankingsBoard games={games} champions={champions} notice={notice} />;
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading rankings" className="space-y-3">
      <div className="skeleton h-9 w-72 rounded-full" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="skeleton h-14 rounded-2xl" />
      ))}
    </div>
  );
}
