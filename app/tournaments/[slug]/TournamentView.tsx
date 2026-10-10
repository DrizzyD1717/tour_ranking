"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, animate, motion, useMotionValue, useTransform } from "framer-motion";
import { computeStandings, type GameRules, type MatchResult, type StandingRow } from "@/lib/tournament";
import { getSupabase, hasSupabase, type MatchRow, type ParticipantRow, type TournamentBundle } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const CREST_COLORS = ["#c6ff3d", "#9a85ff", "#ff7a52", "#3de0e0", "#ffc83d", "#ff8fb1", "#7ee787", "#6ea8ff"];

function crestColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CREST_COLORS[h % CREST_COLORS.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0];
  return letters.toUpperCase();
}

const FORMAT_LABEL = {
  round_robin: "Round robin",
  knockout: "Knockout",
  groups_knockout: "Groups, then knockout",
} as const;

/** Ticks a number up or down when it changes (points, in the table). */
function AnimatedNumber({ value }: { value: number }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => Math.round(v).toString());
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.7, ease: "easeOut" });
    return () => controls.stop();
  }, [value, mv]);
  return <motion.span>{text}</motion.span>;
}

function Crest({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const color = crestColor(name);
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-lg font-display font-bold ${
        size === "sm" ? "size-8 text-sm" : "size-10 text-base"
      }`}
      style={{ color, background: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}55` }}
    >
      {initials(name)}
    </span>
  );
}

function LiveDot() {
  return <span aria-hidden className="size-2 shrink-0 rounded-full bg-live animate-live-pulse" />;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

// Mobile shows rank, team, played, goal difference, points. From sm up the full table appears.
const GRID =
  "grid items-center gap-x-1 px-3 grid-cols-[2rem_minmax(0,1fr)_2.25rem_2.75rem_2.75rem] " +
  "sm:px-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_repeat(4,2.25rem)_repeat(2,2.5rem)_2.75rem_3rem_7rem]";

function Num({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`text-center font-display text-lg tabular-nums text-muted ${className}`}>{children}</span>;
}

function FormChips({ form }: { form: StandingRow["form"] }) {
  const padded = [...Array<null>(5 - form.length).fill(null), ...form];
  return (
    <span className="hidden justify-end gap-1 sm:flex" aria-label={`Last results: ${form.join(", ") || "none yet"}`}>
      {padded.map((r, i) => (
        <span
          key={i}
          className={`grid size-[1.15rem] place-items-center rounded-[5px] font-display text-xs font-bold ${
            r === "W"
              ? "bg-win text-ink-950"
              : r === "D"
                ? "bg-draw text-ink-950"
                : r === "L"
                  ? "bg-loss text-ink-950"
                  : "border border-dashed border-border-strong"
          }`}
        >
          {r}
        </span>
      ))}
    </span>
  );
}

function StandingsTable({
  rows,
  nameOf,
  title,
  intro,
}: {
  rows: StandingRow[];
  nameOf: (id: string) => string;
  title?: string;
  intro: boolean;
}) {
  return (
    <section aria-label={title ? `Group ${title} standings` : "Standings"}>
      {title && <h3 className="mb-3 font-display text-2xl font-bold">Group {title}</h3>}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className={`${GRID} border-b border-border py-2.5 text-xs text-subtle`} aria-hidden>
          <span className="text-center">#</span>
          <span>Team</span>
          <span className="text-center">P</span>
          <span className="hidden text-center sm:block">W</span>
          <span className="hidden text-center sm:block">D</span>
          <span className="hidden text-center sm:block">L</span>
          <span className="hidden text-center sm:block">GF</span>
          <span className="hidden text-center sm:block">GA</span>
          <span className="text-center">GD</span>
          <span className="text-center">Pts</span>
          <span className="hidden text-right sm:block">Form</span>
        </div>

        <ol>
          {rows.map((r, i) => {
            const name = nameOf(r.id);
            const started = r.played > 0;
            const leader = started && r.rank === 1;
            const rankColor = !started ? "text-subtle" : r.rank === 1 ? "text-gold" : r.rank === 2 ? "text-silver" : r.rank === 3 ? "text-bronze" : "text-muted";
            return (
              <motion.li
                key={r.id}
                layout="position"
                initial={intro ? { opacity: 0, x: -18 } : false}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  layout: { type: "spring", stiffness: 420, damping: 36 },
                  opacity: { delay: intro ? i * 0.06 : 0, duration: 0.3 },
                  x: { delay: intro ? i * 0.06 : 0, type: "spring", stiffness: 300, damping: 28 },
                }}
                className={`${GRID} relative border-b border-border/60 py-2.5 last:border-b-0 ${leader ? "bg-primary/[0.06]" : ""}`}
              >
                {leader && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-primary" />}
                <span className={`text-center font-display text-3xl font-bold tabular-nums ${rankColor}`}>{r.rank}</span>
                <span className="flex min-w-0 items-center gap-3">
                  <Crest name={name} />
                  <span className="truncate text-[0.95rem] font-medium">{name}</span>
                </span>
                <Num>{r.played}</Num>
                <Num className="hidden sm:block">{r.won}</Num>
                <Num className="hidden sm:block">{r.drawn}</Num>
                <Num className="hidden sm:block">{r.lost}</Num>
                <Num className="hidden sm:block">{r.for}</Num>
                <Num className="hidden sm:block">{r.against}</Num>
                <Num className={r.diff > 0 ? "!text-win" : r.diff < 0 ? "!text-loss" : ""}>
                  {r.diff > 0 ? `+${r.diff}` : r.diff}
                </Num>
                <span className="text-center font-display text-3xl font-bold tabular-nums text-foreground">
                  <AnimatedNumber value={r.points} />
                </span>
                <FormChips form={r.form} />
              </motion.li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function MatchCard({
  match,
  nameOf,
  showTime,
}: {
  match: MatchRow;
  nameOf: (id: string | null) => string;
  showTime: boolean;
}) {
  const home = nameOf(match.home_id);
  const away = nameOf(match.away_id);
  const live = match.status === "live";
  const finished = match.status === "finished";
  const hasScore = (live || finished) && match.home_score !== null && match.away_score !== null;
  const hs = match.home_score ?? 0;
  const as = match.away_score ?? 0;
  const dim = (mine: number, theirs: number) => (finished && mine < theirs ? "text-subtle" : "text-foreground");

  return (
    <motion.li
      layout="position"
      className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-2xl border bg-surface px-3 py-4 sm:gap-5 sm:px-5 ${
        live ? "border-live/40 shadow-glow-ember" : "border-border"
      }`}
    >
      <span className="flex min-w-0 items-center justify-end gap-3 text-right">
        <span className={`truncate font-medium ${finished && hs < as ? "text-muted" : ""}`}>{home}</span>
        <Crest name={home} size="sm" />
      </span>

      <span className="flex min-w-[5.5rem] flex-col items-center">
        {hasScore ? (
          <span className="flex items-baseline gap-2 font-display text-4xl font-bold leading-none tabular-nums">
            <span className={dim(hs, as)}>{hs}</span>
            <span className="text-xl text-subtle">-</span>
            <span className={dim(as, hs)}>{as}</span>
          </span>
        ) : (
          <span className="font-display text-xl text-subtle">vs</span>
        )}
        {live ? (
          <span className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-live">
            <LiveDot />
            Live
          </span>
        ) : finished ? (
          <span className="mt-1.5 text-xs text-subtle">Full time</span>
        ) : showTime && match.scheduled_at ? (
          <span className="mt-1 text-center text-xs text-subtle">
            {new Date(match.scheduled_at).toLocaleString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ) : null}
      </span>

      <span className="flex min-w-0 items-center gap-3">
        <Crest name={away} size="sm" />
        <span className={`truncate font-medium ${finished && as < hs ? "text-muted" : ""}`}>{away}</span>
      </span>
    </motion.li>
  );
}

function Fixtures({
  matches,
  participants,
  nameOf,
  scoreLabel,
  showTime,
}: {
  matches: MatchRow[];
  participants: ParticipantRow[];
  nameOf: (id: string | null) => string;
  scoreLabel: string;
  showTime: boolean;
}) {
  const rounds = useMemo(() => [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b), [matches]);

  // Open on the first round that still has something to play, otherwise the last round.
  const [round, setRound] = useState(() => {
    const open = rounds.find((r) => matches.some((m) => m.round === r && m.status !== "finished"));
    return open ?? rounds[rounds.length - 1] ?? 1;
  });

  if (rounds.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border-strong px-5 py-10 text-muted">
        No fixtures yet. They appear here once the organizer generates the schedule.
      </p>
    );
  }

  const inRound = matches.filter((m) => m.round === round);
  const playing = new Set(inRound.flatMap((m) => [m.home_id, m.away_id]));
  const resting = participants.filter((p) => !playing.has(p.id));

  return (
    <div>
      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="tablist" aria-label="Rounds">
        {rounds.map((r) => {
          const active = r === round;
          const hasLive = matches.some((m) => m.round === r && m.status === "live");
          return (
            <button
              key={r}
              role="tab"
              aria-selected={active}
              onClick={() => setRound(r)}
              className={`relative flex shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                active ? "text-primary-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="round-pill"
                  className="absolute inset-0 rounded-full bg-primary"
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                />
              )}
              <span className="relative">Round {r}</span>
              {hasLive && <span className="relative"><LiveDot /></span>}
            </button>
          );
        })}
      </div>

      <ul className="space-y-3" aria-label={`Round ${round} matches`}>
        {inRound.map((m) => (
          <MatchCard key={m.id} match={m} nameOf={nameOf} showTime={showTime} />
        ))}
      </ul>

      {resting.length > 0 && resting.length < participants.length && (
        <p className="mt-4 text-sm text-subtle">
          Resting this round: {resting.map((p) => p.name).join(", ")}
        </p>
      )}
      <p className="sr-only">Scores are counted in {scoreLabel.toLowerCase()}.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TABS = [
  { id: "standings", label: "Standings" },
  { id: "fixtures", label: "Fixtures" },
] as const;

export default function TournamentView({ initial, demo }: { initial: TournamentBundle; demo: boolean }) {
  const { tournament, participants } = initial;
  const game = tournament.game;

  const [matches, setMatches] = useState<MatchRow[]>(initial.matches);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("standings");
  const [mounted, setMounted] = useState(false);
  const intro = useRef(true);

  useEffect(() => {
    setMounted(true);
    intro.current = false;
  }, []);

  // Live updates: when a scorekeeper saves a result, everyone's table moves.
  useEffect(() => {
    if (demo || !hasSupabase) return;
    const sb = getSupabase();
    const channel = sb
      .channel(`matches:${tournament.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `tournament_id=eq.${tournament.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const gone = payload.old as Partial<MatchRow>;
            setMatches((ms) => ms.filter((m) => m.id !== gone.id));
          } else {
            const row = payload.new as MatchRow;
            setMatches((ms) => (ms.some((m) => m.id === row.id) ? ms.map((m) => (m.id === row.id ? row : m)) : [...ms, row]));
          }
        },
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [demo, tournament.id]);

  const nameById = useMemo(() => new Map(participants.map((p) => [p.id, p.name])), [participants]);
  const nameOf = (id: string | null) => (id ? (nameById.get(id) ?? "Unknown") : "To be decided");

  const rules: GameRules = useMemo(
    () => ({ allowsDraws: game.allows_draws, ptsWin: game.pts_win, ptsDraw: game.pts_draw, ptsLoss: game.pts_loss }),
    [game],
  );

  const results = useMemo<MatchResult[]>(
    () =>
      matches
        .filter((m) => m.home_id && m.away_id)
        .map((m) => ({
          home: m.home_id as string,
          away: m.away_id as string,
          homeScore: m.home_score,
          awayScore: m.away_score,
          status: m.status,
        })),
    [matches],
  );

  // One table per group (a single untitled table when there are no groups).
  const tables = useMemo(() => {
    const groups = new Map<string, ParticipantRow[]>();
    for (const p of participants) {
      const key = p.group_label ?? "";
      const list = groups.get(key);
      if (list) list.push(p);
      else groups.set(key, [p]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, ps]) => ({ label, rows: computeStandings(ps.map((p) => p.id), results, rules) }));
  }, [participants, results, rules]);

  const played = matches.filter((m) => m.status === "finished").length;
  const pct = matches.length ? Math.round((played / matches.length) * 100) : 0;
  const isEsports = game.category === "esports";
  const accent = isEsports ? "text-esports border-esports/30 bg-esports/10" : "text-sports border-sports/30 bg-sports/10";

  function playNextMatch() {
    setMatches((ms) => {
      const next = [...ms]
        .sort((a, b) => a.round - b.round)
        .find((m) => m.status !== "finished" && m.home_id && m.away_id);
      if (!next) return ms;
      let h = Math.floor(Math.random() * 5);
      const a = Math.floor(Math.random() * 4);
      if (!game.allows_draws && h === a) h++;
      return ms.map((m) => (m.id === next.id ? { ...m, status: "finished", home_score: h, away_score: a } : m));
    });
  }

  const nothingLeft = !matches.some((m) => m.status !== "finished" && m.home_id && m.away_id);

  return (
    <MotionConfig reducedMotion="user">
      <header className="bg-floodlight relative overflow-hidden border-b border-border">
        <div
          aria-hidden
          className="bg-pitch-grid absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
        />
        <div className="relative mx-auto max-w-5xl px-4 pb-8 pt-10 sm:px-6 sm:pb-10 sm:pt-16">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded-full border px-3 py-1 font-medium ${accent}`}>{game.name}</span>
            {tournament.status === "live" && (
              <span className="flex items-center gap-2 rounded-full border border-live/30 bg-live/10 px-3 py-1 font-medium text-live">
                <LiveDot />
                Live now
              </span>
            )}
            {tournament.status === "finished" && (
              <span className="rounded-full border border-border bg-surface-raised px-3 py-1 text-muted">Finished</span>
            )}
            {tournament.status === "draft" && (
              <span className="rounded-full border border-border bg-surface-raised px-3 py-1 text-muted">Not started</span>
            )}
          </div>

          <h1 className="mt-5 font-display text-6xl font-extrabold leading-[0.9] tracking-tight sm:text-8xl">
            {tournament.name}
          </h1>

          <p className="mt-4 max-w-prose text-muted">
            {FORMAT_LABEL[tournament.format]}
            {tournament.format === "round_robin" && tournament.double_round ? ", home and away" : ""} with{" "}
            {participants.length} {isEsports ? "players" : "teams"}.
          </p>

          <div className="mt-6 max-w-sm">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted">
                <span className="font-display text-xl font-bold text-foreground tabular-nums">{played}</span> of{" "}
                {matches.length} matches played
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-raised">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={false}
                animate={{ width: `${pct}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
              />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {demo && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border-strong px-4 py-3 text-sm text-muted">
            <span>This is demo data. Play a match and watch the table move.</span>
            <button
              onClick={playNextMatch}
              disabled={nothingLeft}
              className="cursor-pointer rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground transition hover:shadow-glow-lime disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {nothingLeft ? "All matches played" : "Play next match"}
            </button>
          </div>
        )}

        <div role="tablist" aria-label="Tournament views" className="mb-6 flex gap-1 border-b border-border">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`relative cursor-pointer px-4 py-3 font-display text-xl font-semibold transition-colors ${
                  active ? "text-foreground" : "text-subtle hover:text-muted"
                }`}
              >
                {t.label}
                {active && (
                  <motion.span
                    layoutId="tab-underline"
                    className="absolute inset-x-3 -bottom-px h-0.5 rounded bg-primary shadow-glow-lime"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
          >
            {tab === "standings" ? (
              tournament.format === "knockout" ? (
                <p className="rounded-2xl border border-dashed border-border-strong px-5 py-10 text-muted">
                  Knockout tournaments show a bracket instead of a table. The bracket view is next on the build list;
                  the Fixtures tab already lists every match.
                </p>
              ) : participants.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border-strong px-5 py-10 text-muted">
                  No teams yet. Add teams to this tournament to start the table.
                </p>
              ) : (
                <div className="space-y-8">
                  {tables.map((t) => (
                    <StandingsTable
                      key={t.label}
                      title={t.label || undefined}
                      rows={t.rows}
                      nameOf={(id) => nameOf(id)}
                      intro={intro.current}
                    />
                  ))}
                  <p className="text-sm text-subtle">
                    Ranked by points, then goal difference, then {game.score_label.toLowerCase()} scored, then results
                    between the tied teams.
                  </p>
                </div>
              )
            ) : (
              <Fixtures
                matches={matches}
                participants={participants}
                nameOf={nameOf}
                scoreLabel={game.score_label}
                showTime={mounted}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </MotionConfig>
  );
}
