"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import type { TournamentSummary } from "@/lib/supabase";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "sport", label: "Physical sports" },
  { id: "esports", label: "Esports" },
] as const;

type Filter = (typeof FILTERS)[number]["id"];

const FORMAT_LABEL = {
  round_robin: "Round robin",
  knockout: "Knockout",
  groups_knockout: "Groups, then knockout",
} as const;

function Row({ t }: { t: TournamentSummary }) {
  const esports = t.game.category === "esports";
  const pct = t.total ? Math.round((t.played / t.total) * 100) : 0;
  const live = t.status === "live";

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Link
        href={`/tournaments/${t.slug}`}
        className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4 py-4 transition-colors hover:bg-surface-raised sm:gap-5 sm:px-5"
      >
        <span aria-hidden className={`h-14 w-1 rounded-full ${esports ? "bg-esports" : "bg-sports"}`} />

        <span className="min-w-0">
          <span className="block truncate font-display text-3xl font-bold leading-tight">{t.name}</span>
          <span className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted">
            <span className={esports ? "text-esports" : "text-sports"}>{t.game.name}</span>
            <span>
              {t.entrants} {esports ? "players" : "teams"}
            </span>
            <span>{FORMAT_LABEL[t.format]}</span>
          </span>
        </span>

        <span className="flex w-24 flex-col items-end sm:w-32">
          {t.total > 0 ? (
            <>
              <span className="font-display text-4xl font-bold leading-none tabular-nums">
                {t.played}
                <span className="text-xl text-subtle">/{t.total}</span>
              </span>
              <span className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-raised group-hover:bg-border">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </span>
            </>
          ) : (
            <span className="text-sm text-subtle">No fixtures</span>
          )}
          <span className="mt-1.5 flex items-center gap-1.5 text-xs">
            {live ? (
              <>
                <span aria-hidden className="size-2 rounded-full bg-live animate-live-pulse" />
                <span className="font-semibold text-live">Live</span>
              </>
            ) : t.status === "finished" ? (
              <span className="text-subtle">Finished</span>
            ) : (
              <span className="text-subtle">Not started</span>
            )}
          </span>
        </span>
      </Link>
    </motion.li>
  );
}

function Section({ title, live, items }: { title: string; live?: boolean; items: TournamentSummary[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title}>
      <h2 className="mb-3 flex items-center gap-3 font-display text-2xl font-bold">
        {live && <span aria-hidden className="size-2.5 rounded-full bg-live animate-live-pulse" />}
        {title}
      </h2>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((t) => (
            <Row key={t.id} t={t} />
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}

export default function TournamentBrowser({
  tournaments,
  notice,
}: {
  tournaments: TournamentSummary[];
  notice?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const count = (f: Filter) => (f === "all" ? tournaments.length : tournaments.filter((t) => t.game.category === f).length);
  const shown = filter === "all" ? tournaments : tournaments.filter((t) => t.game.category === filter);
  const live = shown.filter((t) => t.status === "live");
  const rest = shown.filter((t) => t.status !== "live");
  const filterLabel = FILTERS.find((f) => f.id === filter)?.label ?? "";

  return (
    <MotionConfig reducedMotion="user">
      {notice && (
        <p className="mb-6 rounded-2xl border border-dashed border-border-strong px-5 py-4 text-muted">{notice}</p>
      )}

      {tournaments.length > 0 && (
        <div className="-mx-4 mb-8 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label="Filter by type">
          {FILTERS.map((f) => {
            const active = f.id === filter;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(f.id)}
                className={`relative flex shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  active ? "text-primary-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="filter-pill"
                    className="absolute inset-0 rounded-full bg-primary"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
                <span className="relative">{f.label}</span>{" "}
                <span className={`relative font-display text-base tabular-nums ${active ? "" : "text-subtle"}`}>
                  {count(f.id)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {tournaments.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-10">
          <p className="font-display text-3xl font-bold">No public tournaments yet.</p>
          <p className="mt-2 max-w-md text-muted">Be the first. Pick a game, add the teams, and the fixtures are made for you.</p>
          <Link
            href="/tournaments/new"
            className="mt-6 inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:shadow-glow-lime"
          >
            Start a tournament
          </Link>
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border-strong px-5 py-10 text-muted">
          No {filterLabel.toLowerCase()} tournaments yet. Try another filter, or start one.
        </p>
      ) : (
        <div className="space-y-10">
          <Section title="Happening now" live items={live} />
          <Section title={live.length > 0 ? "Recent" : "Tournaments"} items={rest} />
        </div>
      )}
    </MotionConfig>
  );
}
