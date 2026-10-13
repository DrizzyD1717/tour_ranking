"use client";

import { useState } from "react";
import Link from "next/link";
import { MotionConfig, motion } from "framer-motion";
import { sortRankings, type Champion, type GameRanking, type RankingRow, type RankingSort } from "@/lib/tournament";
import Crest from "./Crest";

const SORTS: { id: RankingSort; label: string; hint: string }[] = [
  { id: "titles", label: "Titles", hint: "Tournaments won, then wins, then goal difference." },
  { id: "wins", label: "Wins", hint: "Most matches won, then titles, then goal difference." },
  { id: "winRate", label: "Win rate", hint: "Share of matches won. A short record can top this list." },
];

// Mobile: rank, name, titles, wins, win rate. From sm up: the full record.
const GRID =
  "grid items-center gap-x-1 px-3 grid-cols-[2rem_minmax(0,1fr)_2.75rem_2.5rem_3.25rem] " +
  "sm:px-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_2.75rem_repeat(4,2.25rem)_2.75rem_2.5rem_3.5rem]";

function Cell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`text-center font-display text-lg tabular-nums text-muted ${className}`}>{children}</span>;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function Row({ row, rank, i, intro }: { row: RankingRow; rank: number; i: number; intro: boolean }) {
  const rankColor = rank === 1 ? "text-gold" : rank === 2 ? "text-silver" : rank === 3 ? "text-bronze" : "text-muted";
  return (
    <motion.li
      layout="position"
      initial={intro ? { opacity: 0, x: -18 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        layout: { type: "spring", stiffness: 420, damping: 36 },
        opacity: { delay: intro ? Math.min(i, 12) * 0.05 : 0, duration: 0.3 },
        x: { delay: intro ? Math.min(i, 12) * 0.05 : 0, type: "spring", stiffness: 300, damping: 28 },
      }}
      className={`${GRID} relative border-b border-border/60 py-2.5 last:border-b-0 ${rank === 1 ? "bg-gold/[0.05]" : ""}`}
    >
      {rank === 1 && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-gold" />}
      <span className={`text-center font-display text-3xl font-bold tabular-nums ${rankColor}`}>{rank}</span>
      <span className="flex min-w-0 items-center gap-3">
        <Crest name={row.name} />
        <span className="min-w-0">
          <span className="block truncate text-[0.95rem] font-medium">{row.name}</span>
          <span className="block truncate text-xs text-subtle">
            {row.tournaments} {row.tournaments === 1 ? "tournament" : "tournaments"}
          </span>
        </span>
      </span>
      <span
        className={`text-center font-display text-3xl font-bold tabular-nums ${row.titles > 0 ? "text-gold" : "text-subtle"}`}
        aria-label={`${row.titles} ${row.titles === 1 ? "title" : "titles"}`}
      >
        {row.titles}
      </span>
      <Cell className="hidden sm:block">{row.played}</Cell>
      <Cell className="sm:hidden">{row.won}</Cell>
      <Cell className="hidden sm:block">{row.won}</Cell>
      <Cell className="hidden sm:block">{row.drawn}</Cell>
      <Cell className="hidden sm:block">{row.lost}</Cell>
      <Cell className={`hidden sm:block ${row.diff > 0 ? "!text-win" : row.diff < 0 ? "!text-loss" : ""}`}>
        {row.diff > 0 ? `+${row.diff}` : row.diff}
      </Cell>
      <Cell className="hidden sm:block">{row.tournaments}</Cell>
      <span className="text-center font-display text-2xl font-bold tabular-nums text-foreground">{row.played ? pct(row.winRate) : "-"}</span>
    </motion.li>
  );
}

export default function RankingsBoard({
  games,
  champions,
  notice,
}: {
  games: GameRanking[];
  champions: Champion[];
  notice?: string;
}) {
  const [slug, setSlug] = useState(games[0]?.slug ?? "");
  const [sort, setSort] = useState<RankingSort>("titles");
  const [intro, setIntro] = useState(true);

  const game = games.find((g) => g.slug === slug) ?? games[0];
  const rows = game ? sortRankings(game.rows, sort) : [];
  const recent = champions.slice(0, 8);

  return (
    <MotionConfig reducedMotion="user">
      {notice && <p className="mb-6 rounded-2xl border border-dashed border-border-strong px-5 py-4 text-muted">{notice}</p>}

      {!game ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-10">
          <p className="font-display text-3xl font-bold">No results to rank yet.</p>
          <p className="mt-2 max-w-md text-muted">
            Rankings appear once a public tournament has finished matches. Start one and enter some scores.
          </p>
          <Link
            href="/tournaments/new"
            className="mt-6 inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:shadow-glow-lime"
          >
            Start a tournament
          </Link>
        </div>
      ) : (
        <div className="space-y-10">
          {recent.length > 0 && (
            <section aria-label="Recent champions">
              <h2 className="mb-3 font-display text-2xl font-bold">Recent champions</h2>
              <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
                {recent.map((c, i) => (
                  <motion.li
                    key={c.tournamentId}
                    initial={intro ? { opacity: 0, y: 10 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06, duration: 0.3 }}
                    className="w-72 shrink-0 snap-start"
                  >
                    <Link
                      href={`/tournaments/${c.slug}`}
                      className="flex h-full items-center gap-3 rounded-2xl border border-gold/30 bg-gold/[0.06] px-4 py-3 transition-colors hover:border-gold/60"
                    >
                      <Crest name={c.name} />
                      <span className="min-w-0">
                        <span className="block truncate font-display text-2xl font-bold leading-none text-gold">{c.name}</span>
                        <span className="mt-1 block truncate text-xs text-muted">{c.tournament}</span>
                        <span className="block truncate text-xs text-subtle">{c.game}</span>
                      </span>
                    </Link>
                  </motion.li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="All-time table">
            <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Game">
              {games.map((g) => {
                const active = g.slug === game.slug;
                return (
                  <button
                    key={g.slug}
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setSlug(g.slug);
                      setIntro(false);
                    }}
                    className={`relative flex shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                      active ? "text-primary-foreground" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="game-pill"
                        className="absolute inset-0 rounded-full bg-primary"
                        transition={{ type: "spring", stiffness: 500, damping: 38 }}
                      />
                    )}
                    <span className="relative">{g.name}</span>
                    <span className={`relative font-display text-base tabular-nums ${active ? "" : "text-subtle"}`}>{g.rows.length}</span>
                  </button>
                );
              })}
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div role="group" aria-label="Sort by" className="flex gap-1 rounded-full border border-border p-1">
                {SORTS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={sort === s.id}
                    onClick={() => {
                      setSort(s.id);
                      setIntro(false);
                    }}
                    className={`cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                      sort === s.id ? "bg-surface-raised text-foreground" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="text-sm text-subtle">{SORTS.find((s) => s.id === sort)?.hint}</p>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
              <div className={`${GRID} border-b border-border py-2.5 text-xs text-subtle`} aria-hidden>
                <span className="text-center">#</span>
                <span>{game.category === "esports" ? "Player" : "Team"}</span>
                <span className="text-center">Titles</span>
                <span className="hidden text-center sm:block">P</span>
                <span className="text-center sm:hidden">W</span>
                <span className="hidden text-center sm:block">W</span>
                <span className="hidden text-center sm:block">D</span>
                <span className="hidden text-center sm:block">L</span>
                <span className="hidden text-center sm:block">GD</span>
                <span className="hidden text-center sm:block">T</span>
                <span className="text-center">Win %</span>
              </div>
              <ol aria-label={`${game.name} all-time rankings`}>
                {rows.map((r, i) => (
                  <Row key={r.key} row={r} rank={i + 1} i={i} intro={intro} />
                ))}
              </ol>
            </div>

            <p className="mt-4 max-w-prose text-sm text-subtle">
              Only public tournaments count, across {game.tournaments} {game.tournaments === 1 ? "tournament" : "tournaments"} of{" "}
              {game.name}. There are no accounts behind team and player names, so entrants with the same name are treated as
              one. T is the number of tournaments entered.
            </p>
          </section>
        </div>
      )}
    </MotionConfig>
  );
}
