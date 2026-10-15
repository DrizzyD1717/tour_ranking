"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import type { TournamentSummary } from "@/lib/supabase";
import Crest from "./Crest";

const FORMAT: Record<TournamentSummary["format"], string> = {
  round_robin: "League",
  knockout: "Knockout",
  groups_knockout: "Groups + knockout",
};

type Filter = "all" | "esports" | "sport";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "esports", label: "Esports" },
  { id: "sport", label: "Physical sports" },
];

export default function TournamentBrowser({
  tournaments,
  notice,
  emptyText = "No tournaments yet. Start the first one.",
}: {
  tournaments: TournamentSummary[];
  notice?: string;
  emptyText?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = tournaments.filter((t) => filter === "all" || t.game.category === filter);
  const count = (f: Filter) => tournaments.filter((t) => f === "all" || t.game.category === f).length;

  return (
    <div>
      {notice && <p className="mb-6 rounded-xl border border-border bg-surface px-4 py-3 text-muted">{notice}</p>}

      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter by type">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
              filter === f.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border-strong text-muted hover:text-foreground"
            }`}
          >
            {f.label}{" "}
            <span className="tabular-nums opacity-70">{count(f.id)}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border-strong px-6 py-12 text-center text-muted">
          {tournaments.length === 0 ? emptyText : "Nothing in this category yet."}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((t, i) => (
            <motion.li
              key={t.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.3 }}
            >
              <Link
                href={`/tournaments/${t.slug}`}
                className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 transition hover:border-border-strong hover:bg-surface-raised"
              >
                <Crest name={t.game.name} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-2xl font-bold leading-tight">{t.name}</p>
                  <p className="mt-0.5 truncate text-sm text-muted">
                    {t.game.name} · {FORMAT[t.format]} · {t.entrants} {t.entrants === 1 ? "entrant" : "entrants"}
                    {t.total > 0 && ` · ${t.played}/${t.total} played`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {t.status === "live" && (
                    <span className="rounded-full bg-live/15 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-live">
                      Live
                    </span>
                  )}
                  {t.status === "finished" && (
                    <span className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-muted">
                      Finished
                    </span>
                  )}
                  {t.visibility && t.visibility !== "public" && (
                    <span className="rounded-full border border-border-strong px-2.5 py-1 text-xs font-semibold text-muted">
                      {t.visibility === "private" ? "Private" : "Link only"}
                    </span>
                  )}
                </div>
              </Link>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}
