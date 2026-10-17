import { cache, Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import Crest from "@/app/components/Crest";
import { getSupabase, hasSupabase, listRankingTournaments } from "@/lib/supabase";
import { buildRankings, recordFor } from "@/lib/tournament";

// Public page for one account: its record in every game, and the tournaments it has won.
// Request-time data sits inside <Suspense> (required with cacheComponents).

const USERNAME = /^[a-z0-9_]{3,20}$/;

const findProfile = cache(async (username: string) => {
  if (!hasSupabase || !USERNAME.test(username)) return null;
  const { data, error } = await getSupabase().from("profiles").select("id, username").eq("username", username).maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; username: string } | null;
});

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${username.toLowerCase()}` };
}

export default function PlayerPage({ params }: { params: Promise<{ username: string }> }) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Player params={params} />
    </Suspense>
  );
}

async function Player({ params }: { params: Promise<{ username: string }> }) {
  await connection();
  const username = (await params).username.toLowerCase();
  const profile = await findProfile(username);
  if (!profile) notFound();

  let records;
  let titles;
  try {
    const rankings = buildRankings(await listRankingTournaments());
    records = recordFor(rankings.games, profile.id);
    titles = rankings.champions.filter((c) => c.key === `u:${profile.id}`);
  } catch (e) {
    return (
      <p role="alert" className="mx-auto mt-10 max-w-5xl rounded-xl border border-loss/40 bg-loss/10 px-4 py-3 text-loss">
        Couldn&apos;t load this record: {e instanceof Error ? e.message : "unknown error"}
      </p>
    );
  }

  return (
    <main>
      <section className="bg-floodlight relative overflow-hidden border-b border-border">
        <div
          aria-hidden
          className="bg-pitch-grid absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
        />
        <div className="relative mx-auto flex max-w-5xl items-center gap-5 px-4 pb-10 pt-14 sm:px-6 sm:pb-14 sm:pt-20">
          <Crest name={profile.username} />
          <div className="min-w-0">
            <h1 className="truncate font-display text-5xl font-extrabold leading-[0.9] tracking-tight sm:text-8xl">
              @{profile.username}
            </h1>
            <p className="mt-3 text-muted">
              {records.length === 0
                ? "No results in public tournaments yet."
                : `${titles.length} ${titles.length === 1 ? "title" : "titles"} across ${records.length} ${records.length === 1 ? "game" : "games"}.`}
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl space-y-10 px-4 py-10 sm:px-6 sm:py-14">
        {records.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {records.map((r) => (
              <li key={r.game.slug} className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-display text-3xl font-bold">{r.game.name}</span>
                  <span className="text-sm text-muted">
                    #{r.rank} of {r.of}
                  </span>
                </div>
                <p className="mt-2 text-muted">
                  <span className="font-medium text-foreground">
                    {r.row.titles} {r.row.titles === 1 ? "title" : "titles"}
                  </span>
                  {" · "}
                  {r.row.won}W {r.row.drawn}D {r.row.lost}L{" · "}
                  {Math.round(r.row.winRate * 100)}% wins
                </p>
              </li>
            ))}
          </ul>
        )}

        {titles.length > 0 && (
          <div>
            <h2 className="mb-3 font-display text-3xl font-bold">Titles</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {titles.map((c) => (
                <li key={c.tournamentId}>
                  <Link
                    href={`/tournaments/${c.slug}`}
                    className="block rounded-2xl border border-gold/30 bg-gold/[0.06] px-4 py-3 transition-colors hover:border-gold/60"
                  >
                    <span className="block truncate font-display text-2xl font-bold text-gold">{c.tournament}</span>
                    <span className="block truncate text-sm text-muted">{c.game}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Link href="/rankings" className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
          See the full rankings
        </Link>
      </section>
    </main>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading player" className="mx-auto max-w-5xl space-y-4 px-4 py-16 sm:px-6">
      <div className="skeleton h-20 w-2/3 rounded-2xl" />
      <div className="skeleton h-28 rounded-2xl" />
    </div>
  );
}
