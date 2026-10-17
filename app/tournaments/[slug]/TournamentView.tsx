"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, MotionConfig, animate, motion, useMotionValue, useTransform } from "framer-motion";
import {
  accountUsername,
  advanceKnockout,
  archiveDueAt,
  isArchived,
  type ArchiveMode,
  computeStandings,
  generateKnockout,
  knockoutWinner,
  layoutBracket,
  roundName,
  seedQualifiers,
  type BracketLayout,
  type GameRules,
  type MatchResult,
  type StandingRow,
} from "@/lib/tournament";
import {
  getSupabase,
  getTournamentBundle,
  hasSupabase,
  type MatchRow,
  type ParticipantRow,
  type Tournament,
  type TournamentBundle,
} from "@/lib/supabase";
import { useUser } from "@/lib/use-user";
import Crest from "@/app/components/Crest";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

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
  qualify,
}: {
  rows: StandingRow[];
  nameOf: (id: string) => string;
  title?: string;
  intro: boolean;
  /** Groups only: how many places go through. Marks them and draws a line under the last one. */
  qualify?: number;
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
            const through = qualify !== undefined && i < qualify;
            const cutLine = qualify !== undefined && i === qualify - 1 && i < rows.length - 1;
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
                className={`${GRID} relative py-2.5 last:border-b-0 ${
                  cutLine ? "border-b-2 border-dashed border-primary/30" : "border-b border-border/60"
                } ${leader ? "bg-primary/[0.06]" : ""}`}
              >
                {(leader || through) && (
                  <span
                    aria-hidden
                    className={`absolute inset-y-2 left-0 w-[3px] rounded-r ${leader ? "bg-primary" : "bg-primary/40"}`}
                  />
                )}
                <span className={`text-center font-display text-3xl font-bold tabular-nums ${rankColor}`}>{r.rank}</span>
                <span className="flex min-w-0 items-center gap-3">
                  <Crest name={name} />
                  <span className="truncate text-[0.95rem] font-medium">{name}</span>
                  {through && <span className="sr-only"> (goes through)</span>}
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

type ScorePatch = Partial<Pick<MatchRow, "status" | "home_score" | "away_score">>;
/** Saves a change to one match. Resolves to an error message, or null when it worked. */
type SaveMatch = (id: string, patch: ScorePatch) => Promise<string | null>;

const MAX_SCORE = 99;
const SMALL_BTN =
  "cursor-pointer rounded-full border border-border-strong px-4 py-2 text-sm font-medium transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-40";
const PRIMARY_BTN =
  "cursor-pointer rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:shadow-glow-lime disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none";
const ROUND_BTN =
  "grid cursor-pointer place-items-center rounded-full border border-border-strong transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-40";

const clampScore = (n: number) => Math.min(MAX_SCORE, Math.max(0, n));

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={`Remove one from ${label}`}
        disabled={value <= 0}
        onClick={() => onChange(clampScore(value - 1))}
        className={`${ROUND_BTN} size-11 text-xl`}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_SCORE}
        aria-label={`${label} score`}
        value={value}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          onChange(Number.isNaN(n) ? 0 : clampScore(n));
        }}
        className="w-16 rounded-xl border border-border bg-surface-sunken py-2 text-center font-display text-3xl font-bold tabular-nums outline-none focus:border-primary"
      />
      <button
        type="button"
        aria-label={`Add one to ${label}`}
        disabled={value >= MAX_SCORE}
        onClick={() => onChange(clampScore(value + 1))}
        className={`${ROUND_BTN} size-11 text-xl`}
      >
        +
      </button>
    </div>
  );
}

function TbdCrest() {
  return <span aria-hidden className="size-8 shrink-0 rounded-lg border border-dashed border-border-strong" />;
}

function MatchCard({
  match,
  nameOf,
  showTime,
  canScore,
  onSave,
}: {
  match: MatchRow;
  nameOf: (id: string | null) => string;
  showTime: boolean;
  canScore: boolean;
  onSave: SaveMatch;
}) {
  const home = nameOf(match.home_id);
  const away = nameOf(match.away_id);
  const live = match.status === "live";
  const finished = match.status === "finished";
  const hasScore = (live || finished) && match.home_score !== null && match.away_score !== null;
  const hs = match.home_score ?? 0;
  const as = match.away_score ?? 0;
  const dim = (mine: number, theirs: number) => (finished && mine < theirs ? "text-subtle" : "text-foreground");
  const bothTeams = match.home_id !== null && match.away_id !== null;

  const [editing, setEditing] = useState(false);
  const [draftHome, setDraftHome] = useState(0);
  const [draftAway, setDraftAway] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(patch: ScorePatch) {
    setBusy(true);
    setError(null);
    const problem = await onSave(match.id, patch);
    setBusy(false);
    if (problem) setError(problem);
    return problem === null;
  }

  const bump = (side: "home_score" | "away_score", delta: number) =>
    run({ [side]: clampScore((match[side] ?? 0) + delta) });

  function openEditor() {
    setDraftHome(match.home_score ?? 0);
    setDraftAway(match.away_score ?? 0);
    setError(null);
    setEditing(true);
  }

  async function saveDraft(status: "live" | "finished") {
    if (await run({ status, home_score: draftHome, away_score: draftAway })) setEditing(false);
  }

  async function clearResult() {
    if (await run({ status: "scheduled", home_score: null, away_score: null })) setEditing(false);
  }

  const controls = canScore && bothTeams && !editing;

  return (
    <motion.li
      layout="position"
      className={`flex flex-col gap-4 rounded-2xl border bg-surface px-3 py-4 sm:px-5 ${
        live ? "border-live/40 shadow-glow-ember" : "border-border"
      }`}
    >
      {match.group_label && (
        <p className="-mb-2 text-center text-xs font-medium uppercase tracking-widest text-subtle">Group {match.group_label}</p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-5">
        <span className="flex min-w-0 items-center justify-end gap-3 text-right">
          <span className={`truncate font-medium ${!match.home_id ? "italic text-subtle" : finished && hs < as ? "text-muted" : ""}`}>{home}</span>
          {match.home_id ? <Crest name={home} size="sm" /> : <TbdCrest />}
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
          {match.away_id ? <Crest name={away} size="sm" /> : <TbdCrest />}
          <span className={`truncate font-medium ${!match.away_id ? "italic text-subtle" : finished && as < hs ? "text-muted" : ""}`}>{away}</span>
        </span>
      </div>

      {canScore && !bothTeams && (
        <p className="text-center text-sm text-subtle">Waiting for the matches before this one to finish.</p>
      )}

      {controls &&
        (live ? (
          // Live: tap to add or remove a point, each tap saves straight away.
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-5">
            <span className="flex justify-end gap-2">
              <button type="button" aria-label={`Remove one from ${home}`} disabled={busy || hs <= 0} onClick={() => bump("home_score", -1)} className={`${ROUND_BTN} size-10 text-lg`}>
                −
              </button>
              <button type="button" aria-label={`Add one to ${home}`} disabled={busy || hs >= MAX_SCORE} onClick={() => bump("home_score", 1)} className={`${ROUND_BTN} size-10 text-lg`}>
                +
              </button>
            </span>
            <button type="button" disabled={busy} onClick={() => run({ status: "finished" })} className={`${PRIMARY_BTN} min-w-[5.5rem]`}>
              Full time
            </button>
            <span className="flex gap-2">
              <button type="button" aria-label={`Remove one from ${away}`} disabled={busy || as <= 0} onClick={() => bump("away_score", -1)} className={`${ROUND_BTN} size-10 text-lg`}>
                −
              </button>
              <button type="button" aria-label={`Add one to ${away}`} disabled={busy || as >= MAX_SCORE} onClick={() => bump("away_score", 1)} className={`${ROUND_BTN} size-10 text-lg`}>
                +
              </button>
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-2">
            {!finished && (
              <button type="button" disabled={busy} onClick={() => run({ status: "live", home_score: 0, away_score: 0 })} className={SMALL_BTN}>
                Start match
              </button>
            )}
            <button type="button" disabled={busy} onClick={openEditor} className={SMALL_BTN}>
              {finished ? "Edit result" : "Enter result"}
            </button>
          </div>
        ))}

      {canScore && editing && (
        <div className="border-t border-border pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex min-w-0 flex-col items-center gap-2">
              <span className="max-w-full truncate text-sm text-muted">{home}</span>
              <Stepper label={home} value={draftHome} onChange={setDraftHome} />
            </div>
            <div className="flex min-w-0 flex-col items-center gap-2">
              <span className="max-w-full truncate text-sm text-muted">{away}</span>
              <Stepper label={away} value={draftAway} onChange={setDraftAway} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button type="button" disabled={busy} onClick={() => saveDraft("finished")} className={PRIMARY_BTN}>
              Save as full time
            </button>
            {!finished && (
              <button type="button" disabled={busy} onClick={() => saveDraft("live")} className={SMALL_BTN}>
                Save as live
              </button>
            )}
            {(live || finished) && (
              <button type="button" disabled={busy} onClick={clearResult} className={SMALL_BTN}>
                Clear result
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => setEditing(false)} className={SMALL_BTN}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-center text-sm text-loss">
          {error}
        </p>
      )}
    </motion.li>
  );
}

function Fixtures({
  matches,
  participants,
  nameOf,
  scoreLabel,
  showTime,
  canScore,
  onSave,
  roundLabel,
  showResting,
}: {
  matches: MatchRow[];
  participants: ParticipantRow[];
  nameOf: (id: string | null) => string;
  scoreLabel: string;
  showTime: boolean;
  canScore: boolean;
  onSave: SaveMatch;
  roundLabel: (round: number) => string;
  showResting: boolean;
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

  const inRound = matches
    .filter((m) => m.round === round)
    .sort((a, b) => (a.group_label ?? "").localeCompare(b.group_label ?? ""));
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
              <span className="relative">{roundLabel(r)}</span>
              {hasLive && <span className="relative"><LiveDot /></span>}
            </button>
          );
        })}
      </div>

      <ul className="space-y-3" aria-label={`${roundLabel(round)} matches`}>
        {inRound.map((m) => (
          <MatchCard key={m.id} match={m} nameOf={nameOf} showTime={showTime} canScore={canScore} onSave={onSave} />
        ))}
      </ul>

      {showResting && resting.length > 0 && resting.length < participants.length && (
        <p className="mt-4 text-sm text-subtle">
          Resting this round: {resting.map((p) => p.name).join(", ")}
        </p>
      )}
      <p className="sr-only">Scores are counted in {scoreLabel.toLowerCase()}.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Knockout bracket
// ---------------------------------------------------------------------------

const SLOT_H = 112; // height of one round-1 slot in px; every later round doubles it
const CARD_W = 208;
const GAP = 32; // space between columns, where the connector lines run

function ChampionBanner({ name, detail }: { name: string; detail: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      className="flex items-center gap-4 rounded-2xl border border-gold/40 bg-gold/10 px-5 py-4"
    >
      <Crest name={name} />
      <div className="min-w-0">
        <p className="truncate font-display text-4xl font-extrabold leading-none text-gold">{name}</p>
        <p className="mt-1.5 text-sm text-muted">{detail}</p>
      </div>
    </motion.div>
  );
}

function BracketTeam({
  id,
  name,
  score,
  won,
  lost,
  fadeIn,
}: {
  id: string | null;
  name: string;
  score: number | null;
  won: boolean;
  lost: boolean;
  fadeIn: boolean;
}) {
  return (
    <div
      className={`relative flex items-center gap-2 px-3 py-2 ${
        won ? "bg-primary/10 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary" : ""
      }`}
    >
      {id ? <Crest name={name} size="xs" /> : <span aria-hidden className="size-6 shrink-0 rounded-md border border-dashed border-border-strong" />}
      {/* Re-keyed by name so a winner sliding into an empty slot fades in. */}
      <motion.span
        key={name}
        initial={fadeIn ? { opacity: 0, y: 6 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={`min-w-0 flex-1 truncate text-sm ${!id ? "italic text-subtle" : lost ? "text-muted" : "font-semibold"}`}
      >
        {name}
      </motion.span>
      {score !== null && (
        <span className={`font-display text-2xl font-bold leading-none tabular-nums ${lost ? "text-subtle" : ""}`}>{score}</span>
      )}
    </div>
  );
}

function BracketCard({
  match,
  nameOf,
  fadeIn,
}: {
  match: MatchRow;
  nameOf: (id: string | null) => string;
  fadeIn: boolean;
}) {
  const winner = knockoutWinner(match);
  const live = match.status === "live";
  const showScore = (live || match.status === "finished") && match.home_score !== null && match.away_score !== null;
  const home = nameOf(match.home_id);
  const away = nameOf(match.away_id);
  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border bg-surface ${
        live ? "border-live/50 shadow-glow-ember" : "border-border"
      }`}
    >
      <p className="sr-only">
        {home} versus {away}.{" "}
        {match.status === "finished" ? `Full time ${match.home_score} to ${match.away_score}.` : live ? "Live." : "Not played yet."}
      </p>
      <div aria-hidden>
        <BracketTeam
          id={match.home_id}
          name={home}
          score={showScore ? match.home_score : null}
          won={winner !== null && winner === match.home_id}
          lost={winner !== null && winner !== match.home_id}
          fadeIn={fadeIn}
        />
        <div className="h-px bg-border" />
        <BracketTeam
          id={match.away_id}
          name={away}
          score={showScore ? match.away_score : null}
          won={winner !== null && winner === match.away_id}
          lost={winner !== null && winner !== match.away_id}
          fadeIn={fadeIn}
        />
      </div>
      {live && (
        <span className="absolute right-2 top-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-live" aria-hidden>
          <LiveDot />
        </span>
      )}
    </div>
  );
}

function Bracket({
  layout,
  nameOf,
  champion,
  mounted,
  intro,
}: {
  layout: BracketLayout<MatchRow>;
  nameOf: (id: string | null) => string;
  champion: string | null;
  mounted: boolean;
  intro: boolean;
}) {
  const rows0 = layout.columns[0].slots.length * SLOT_H;
  const col1 = layout.columns[0].slots;
  // Entrants who skip round 1: the team already sitting in a round-2 match whose round-1 feeder slot is empty.
  const byes = (layout.columns[1]?.slots ?? []).flatMap((m, pos) => {
    if (!m) return [];
    const out: string[] = [];
    if (!col1[pos * 2] && m.home_id) out.push(m.home_id);
    if (!col1[pos * 2 + 1] && m.away_id) out.push(m.away_id);
    return out;
  });

  return (
    <div>
      <p className="mb-3 text-sm text-subtle sm:hidden">Swipe sideways to see the later rounds.</p>
      <div
        role="region"
        aria-label="Bracket. Scrolls sideways on small screens."
        tabIndex={0}
        className="-mx-4 scroll-pl-4 snap-x overflow-x-auto px-4 pb-4 outline-none sm:scroll-pl-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:mx-0 sm:px-0"
      >
        <div className="flex w-max">
          {layout.columns.map((col, ci) => (
            <section key={col.round} aria-label={roundName(col.round, layout.rounds)} className="shrink-0 snap-start" style={{ width: CARD_W + GAP }}>
              <h3 className="mb-3 font-display text-xl font-semibold text-muted">{roundName(col.round, layout.rounds)}</h3>
              <ol>
                {col.slots.map((m, pos) => {
                  const isFinal = col.round === layout.rounds;
                  const hasFeeder =
                    ci > 0 && (layout.columns[ci - 1].slots[pos * 2] !== null || layout.columns[ci - 1].slots[pos * 2 + 1] !== null);
                  const done = m !== null && m.status === "finished";
                  const line = done ? "border-primary" : "border-border-strong";
                  return (
                    <li
                      key={pos}
                      aria-hidden={m ? undefined : true}
                      style={{ height: SLOT_H * 2 ** ci, width: CARD_W }}
                      className="relative flex items-center"
                    >
                      {m && (
                        <motion.div
                          className="w-full"
                          initial={intro ? { opacity: 0, x: -14 } : false}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.35, delay: ci * 0.12 + pos * 0.03 }}
                        >
                          <BracketCard match={m} nameOf={nameOf} fadeIn={mounted} />
                        </motion.div>
                      )}
                      {m && !isFinal && (
                        <span
                          aria-hidden
                          style={{ width: GAP / 2 }}
                          className={`absolute -right-4 border-r-2 transition-colors duration-500 ${line} ${
                            pos % 2 === 0 ? "top-1/2 h-1/2 border-t-2" : "top-0 h-1/2 border-b-2"
                          }`}
                        />
                      )}
                      {m && isFinal && (
                        <span aria-hidden style={{ width: GAP }} className={`absolute -right-8 top-1/2 border-t-2 transition-colors duration-500 ${line}`} />
                      )}
                      {m && hasFeeder && (
                        <span aria-hidden style={{ width: GAP / 2 }} className="absolute -left-4 top-1/2 border-t-2 border-border-strong" />
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}

          <section aria-label="Champion" className="shrink-0 snap-start" style={{ width: CARD_W }}>
            <h3 className="mb-3 font-display text-xl font-semibold text-muted">Champion</h3>
            <div className="flex items-center" style={{ height: rows0 }}>
              {champion ? (
                <motion.div
                  initial={mounted ? { opacity: 0, scale: 0.9 } : false}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                  className="flex w-full flex-col items-center gap-3 rounded-2xl border border-gold/50 bg-gold/10 px-4 py-6 text-center shadow-[0_0_32px_-4px_rgb(255_200_61/0.45)]"
                >
                  <Crest name={champion} />
                  <span className="font-display text-3xl font-extrabold leading-none text-gold">{champion}</span>
                  <span className="text-xs font-semibold uppercase tracking-widest text-gold/80">Champion</span>
                </motion.div>
              ) : (
                <div className="grid w-full place-items-center rounded-2xl border border-dashed border-border-strong px-4 py-6 text-center text-sm text-subtle">
                  Winner of the final
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {byes.length > 0 && (
        <p className="mt-2 text-sm text-subtle">
          Top seeds skip round 1: {byes.map((id) => nameOf(id)).join(", ")}.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manage (organizer only)
// ---------------------------------------------------------------------------

type AdminRow = { user_id: string; role: "owner" | "scorekeeper"; profile: { username: string } | null };
type Notice = { kind: "error" | "ok"; text: string };

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const FIELD =
  "w-full rounded-xl border border-border bg-surface-sunken px-4 py-3 outline-none transition placeholder:text-subtle focus:border-primary";

function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return notice.kind === "error" ? (
    <p role="alert" className="mt-3 text-sm text-loss">
      {notice.text}
    </p>
  ) : (
    <p role="status" className="mt-3 text-sm text-win">
      {notice.text}
    </p>
  );
}

function SharePanel({ slug, visibility }: { slug: string; visibility: Tournament["visibility"] }) {
  const [origin, setOrigin] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}/tournaments/${slug}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ kind: "ok", text: "Link copied." });
    } catch {
      setNotice({ kind: "error", text: "Couldn't copy automatically. Select the link and copy it by hand." });
    }
  }

  return (
    <section aria-labelledby="share-h" className="p-5 sm:p-6">
      <h3 id="share-h" className="font-display text-2xl font-bold">
        Share the link
      </h3>
      <p className="mt-1 text-muted">
        {visibility === "public"
          ? "This tournament is public, so it is listed on the home page."
          : visibility === "unlisted"
            ? "This tournament is link only. It isn't listed, so people need this link to follow it."
            : "This tournament is private. Only you and your scorekeepers can open this link, and they need to be signed in."}
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input readOnly aria-label="Tournament link" value={url} onFocus={(e) => e.currentTarget.select()} className={FIELD} />
        <button type="button" onClick={copy} className={`${PRIMARY_BTN} shrink-0 py-3`}>
          Copy link
        </button>
      </div>
      <NoticeLine notice={notice} />
    </section>
  );
}

function ScorekeepersPanel({ demo, tournamentId }: { demo: boolean; tournamentId: string }) {
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("tournament_admins")
      .select("user_id, role, profile:profiles(username)")
      .eq("tournament_id", tournamentId);
    if (error) {
      setNotice({ kind: "error", text: `Couldn't load the list: ${error.message}` });
      return;
    }
    const list = (data ?? []) as unknown as AdminRow[];
    setAdmins([...list].sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner")));
  }, [tournamentId]);

  useEffect(() => {
    if (!demo) void load();
  }, [demo, load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const name = username.trim().replace(/^@/, "").toLowerCase();
    if (!USERNAME_RE.test(name)) {
      setNotice({ kind: "error", text: "Enter their username, like dari or player_1a2b3c4d." });
      return;
    }
    setBusy(true);
    setNotice(null);
    const sb = getSupabase();
    const found = await sb.from("profiles").select("id, username").eq("username", name).maybeSingle();
    if (found.error || !found.data) {
      setBusy(false);
      setNotice({
        kind: "error",
        text: found.error
          ? found.error.message
          : `No one has the username @${name}. Ask them to check it on their Account page.`,
      });
      return;
    }
    const person = found.data as { id: string };
    if (admins?.some((a) => a.user_id === person.id)) {
      setBusy(false);
      setNotice({ kind: "error", text: `@${name} already helps run this tournament.` });
      return;
    }
    const added = await sb
      .from("tournament_admins")
      .insert({ tournament_id: tournamentId, user_id: person.id, role: "scorekeeper" });
    setBusy(false);
    if (added.error) {
      setNotice({
        kind: "error",
        text: added.error.code === "42501" ? "Only the organizer can add scorekeepers." : added.error.message,
      });
      return;
    }
    setUsername("");
    setNotice({ kind: "ok", text: `@${name} can now enter scores.` });
    await load();
  }

  async function remove(row: AdminRow) {
    const name = row.profile?.username ?? "that person";
    setBusy(true);
    setNotice(null);
    const { data, error } = await getSupabase()
      .from("tournament_admins")
      .delete()
      .eq("tournament_id", tournamentId)
      .eq("user_id", row.user_id)
      .eq("role", "scorekeeper")
      .select("user_id");
    setBusy(false);
    if (error || !data || data.length === 0) {
      setNotice({ kind: "error", text: error ? error.message : "Couldn't remove them. Reload the page and try again." });
      return;
    }
    setNotice({ kind: "ok", text: `@${name} can no longer enter scores.` });
    await load();
  }

  return (
    <section aria-labelledby="keepers-h" className="p-5 sm:p-6">
      <h3 id="keepers-h" className="font-display text-2xl font-bold">
        Scorekeepers
      </h3>
      <p className="mt-1 text-muted">
        A scorekeeper can enter and fix scores from their own phone. They can&apos;t change teams, add other people or end
        the tournament.
      </p>

      {demo ? (
        <p className="mt-4 rounded-xl border border-dashed border-border-strong px-4 py-3 text-sm text-muted">
          Scorekeepers work on real tournaments. Start one to try it.
        </p>
      ) : (
        <>
          {admins && (
            <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
              {admins.map((a) => (
                <li key={a.user_id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0 truncate font-medium">{a.profile ? `@${a.profile.username}` : "Unknown user"}</span>
                  {a.role === "owner" ? (
                    <span className="shrink-0 text-sm text-subtle">Organizer</span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Remove @${a.profile?.username ?? "user"}`}
                      onClick={() => remove(a)}
                      className={`${SMALL_BTN} shrink-0 py-1.5`}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {admins && admins.length === 1 && (
            <p className="mt-3 text-sm text-subtle">No scorekeepers yet. Ask a friend for their username and add them.</p>
          )}

          <form onSubmit={add} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label htmlFor="keeper" className="sr-only">
              Username of the person to add
            </label>
            <input
              id="keeper"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Their username"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className={FIELD}
            />
            <button type="submit" disabled={busy || username.trim() === ""} className={`${PRIMARY_BTN} shrink-0 py-3`}>
              Add scorekeeper
            </button>
          </form>
        </>
      )}
      <NoticeLine notice={notice} />
    </section>
  );
}

function FinishPanel({
  status,
  unplayed,
  total,
  leaderName,
  onChangeStatus,
}: {
  status: Tournament["status"];
  unplayed: number;
  total: number;
  leaderName: string | null;
  onChangeStatus: (next: "live" | "finished") => Promise<string | null>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finished = status === "finished";

  async function change(next: "live" | "finished") {
    setBusy(true);
    setError(null);
    const problem = await onChangeStatus(next);
    setBusy(false);
    if (problem) setError(problem);
    else setConfirming(false);
  }

  return (
    <section aria-labelledby="finish-h" className="p-5 sm:p-6">
      <h3 id="finish-h" className="font-display text-2xl font-bold">
        {finished ? "This tournament is finished" : "End the tournament"}
      </h3>
      <p className="mt-1 text-muted">
        {finished
          ? `${leaderName ? `${leaderName} won it. ` : ""}Reopen it if a result needs to change or more matches are coming.`
          : unplayed > 0
            ? `${unplayed} ${unplayed === 1 ? "match hasn't" : "matches haven't"} been played yet. ${
                unplayed === 1 ? "It" : "They"
              } won't count if you end it now.`
            : leaderName
              ? `Every match is played and ${leaderName} is top of the table.`
              : total > 0 && unplayed === 0
                ? "Every match is played."
                : "Nobody has played yet."}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {finished ? (
          <button type="button" disabled={busy} onClick={() => change("live")} className={SMALL_BTN}>
            Reopen tournament
          </button>
        ) : confirming ? (
          <>
            <span className="mr-1 font-medium">{leaderName ? `End it and crown ${leaderName}?` : "End it now?"}</span>
            <button type="button" disabled={busy} onClick={() => change("finished")} className={PRIMARY_BTN}>
              Yes, end it
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={SMALL_BTN}>
              Keep going
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={PRIMARY_BTN}>
            End tournament
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-loss">
          {error}
        </p>
      )}
    </section>
  );
}

function KnockoutStagePanel({
  started,
  remaining,
  advance,
  preview,
  onDraw,
}: {
  started: boolean;
  remaining: number;
  advance: number;
  preview: { pairs: { home: string; away: string }[]; byes: string[] } | null;
  onDraw: () => Promise<string | null>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function draw() {
    setBusy(true);
    setError(null);
    const problem = await onDraw();
    setBusy(false);
    if (problem) setError(problem);
    else setConfirming(false);
  }

  return (
    <section aria-labelledby="ko-stage-h" className="p-5 sm:p-6">
      <h3 id="ko-stage-h" className="font-display text-2xl font-bold">
        Knockout stage
      </h3>
      <p className="mt-1 text-muted">
        {started
          ? "The knockout stage is underway. Group results are now locked."
          : remaining > 0
            ? `${remaining} group ${remaining === 1 ? "match" : "matches"} still to play. You can draw the knockout once every group match is finished.`
            : `Every group match is played. The top ${advance} from each group go through.`}
      </p>

      {!started && remaining === 0 && preview && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">First round of the knockout</p>
          <ul className="grid gap-x-6 gap-y-1 text-muted sm:grid-cols-2">
            {preview.pairs.map((p, i) => (
              <li key={i}>
                <span className="text-foreground">{p.home}</span> vs <span className="text-foreground">{p.away}</span>
              </li>
            ))}
          </ul>
          {preview.byes.length > 0 && <p className="mt-2 text-sm text-subtle">Straight into round 2: {preview.byes.join(", ")}.</p>}
        </div>
      )}

      {!started && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <span className="mr-1 font-medium">Draw it now? Group results lock once you do.</span>
              <button type="button" disabled={busy} onClick={draw} className={PRIMARY_BTN}>
                Yes, draw it
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={SMALL_BTN}>
                Not yet
              </button>
            </>
          ) : (
            <button type="button" disabled={remaining > 0} onClick={() => setConfirming(true)} className={PRIMARY_BTN}>
              Draw the knockout stage
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-loss">
          {error}
        </p>
      )}
    </section>
  );
}

const ARCHIVE_OPTIONS: { id: ArchiveMode; label: string; hint: string }[] = [
  { id: "auto", label: "Automatic", hint: "Archived a day after it finishes." },
  { id: "archived", label: "Archive now", hint: "Off the home list straight away." },
  { id: "pinned", label: "Keep active", hint: "Never archived automatically." },
];

/** Archived tournaments leave the home list but keep their page, their rankings and everyone's record. */
function ArchivePanel({
  mode,
  archived,
  due,
  onChange,
}: {
  mode: ArchiveMode;
  archived: boolean;
  due: Date | null;
  onChange: (next: ArchiveMode) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function choose(next: ArchiveMode) {
    if (next === mode || busy) return;
    setBusy(true);
    setNotice(null);
    const error = await onChange(next);
    setBusy(false);
    setNotice(error ? { kind: "error", text: error } : { kind: "ok", text: "Saved." });
  }

  return (
    <section aria-labelledby="archive-h" className="p-5 sm:p-6">
      <h3 id="archive-h" className="font-display text-2xl font-bold">
        Archive
      </h3>
      <p className="mt-1 text-muted">
        {archived
          ? "This tournament is archived. It's off the home list, but its page still works and it still counts in rankings."
          : mode === "pinned"
            ? "This tournament stays on the home list."
            : due
              ? `It will be archived on ${due.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.`
              : "It will be archived a day after it finishes."}
      </p>
      <div role="radiogroup" aria-labelledby="archive-h" className="mt-4 grid gap-3 sm:grid-cols-3">
        {ARCHIVE_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={o.id === mode}
            disabled={busy}
            onClick={() => choose(o.id)}
            className={`cursor-pointer rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
              o.id === mode ? "border-primary bg-primary/5" : "border-border bg-surface hover:border-border-strong"
            }`}
          >
            <span className="block font-display text-xl font-bold">{o.label}</span>
            <span className="mt-1 block text-sm text-muted">{o.hint}</span>
          </button>
        ))}
      </div>
      <NoticeLine notice={notice} />
    </section>
  );
}

/** Permanent delete, behind a typed confirmation so it can't happen by a stray click. */
function DeletePanel({ name, onDelete }: { name: string; onDelete: () => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === name.trim();

  async function confirm() {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    const problem = await onDelete();
    if (problem) {
      setError(problem);
      setBusy(false);
    }
    // On success the page navigates away, so there is nothing to reset.
  }

  return (
    <section aria-labelledby="delete-h" className="p-5 sm:p-6">
      <h3 id="delete-h" className="font-display text-2xl font-bold text-loss">
        Delete tournament
      </h3>
      <p className="mt-1 text-muted">
        Removes the tournament, its fixtures, scores and entrants for everyone. Rankings and player records change too. This
        can&apos;t be undone.
      </p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={`${SMALL_BTN} mt-4 !border-loss/50 text-loss`}>
          Delete this tournament…
        </button>
      ) : (
        <form
          className="mt-4 space-y-3 rounded-2xl border border-loss/40 bg-loss/10 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <label htmlFor="delete-confirm" className="block text-sm">
            Type <span className="font-semibold">{name}</span> to confirm.
          </label>
          <input
            id="delete-confirm"
            autoFocus
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className={FIELD}
          />
          {error && (
            <p role="alert" className="text-sm text-loss">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={!matches || busy} className={`${PRIMARY_BTN} !bg-loss !text-white`}>
              {busy ? "Deleting..." : "Delete forever"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError(null);
              }}
              className={SMALL_BTN}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

const ENTRANT_COLUMNS = "id, tournament_id, name, group_label, seed, user_id, link_status";
const LINK_LABEL = { pending: "Invitation pending", accepted: "Linked", declined: "Declined the link" } as const;

/**
 * The organizer can fix entrants after creating the tournament: rename a plain entrant, link one to an
 * account (the person is invited and must accept), or remove a link. A declined link can be re-sent.
 */
function EntrantsPanel({ participants, onChange }: { participants: ParticipantRow[]; onChange: (row: ParticipantRow) => void }) {
  const [editing, setEditing] = useState<{ id: string; mode: "rename" | "link"; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  /** Saves a change and returns the stored row (with the status the database decided), or an error message. */
  async function save(id: string, patch: Record<string, unknown>): Promise<{ row: ParticipantRow } | { error: string }> {
    const { data, error } = await getSupabase().from("participants").update(patch).eq("id", id).select(ENTRANT_COLUMNS);
    if (error) {
      if (error.code !== "23505") return { error: error.message };
      return { error: /account/.test(error.message) ? "That account is already in this tournament." : "Another entrant already has that name." };
    }
    if (!data || data.length === 0) return { error: "Couldn't save. Only the organizer can edit entrants." };
    return { row: data[0] as ParticipantRow };
  }

  async function run(job: () => Promise<{ row: ParticipantRow } | { error: string }>, ok: string) {
    setBusy(true);
    setNotice(null);
    const result = await job();
    setBusy(false);
    if ("error" in result) {
      setNotice({ kind: "error", text: result.error });
      return;
    }
    onChange(result.row);
    setEditing(null);
    setNotice({ kind: "ok", text: ok });
  }

  function rename(p: ParticipantRow, raw: string) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (name.length < 1 || name.length > 40) return setNotice({ kind: "error", text: "A name is 1 to 40 characters." });
    if (name.startsWith("@")) return setNotice({ kind: "error", text: "Names can't start with @. Use Link account to link a person." });
    void run(() => save(p.id, { name }), `Renamed to ${name}.`);
  }

  function link(p: ParticipantRow, raw: string) {
    const username = accountUsername(raw.trim().startsWith("@") ? raw : `@${raw.trim()}`);
    if (!username) return setNotice({ kind: "error", text: "An @username is 3 to 20 letters, numbers or underscores." });
    void run(async () => {
      const found = await getSupabase().from("profiles").select("id, username").eq("username", username).maybeSingle();
      if (found.error) return { error: found.error.message };
      const person = found.data as { id: string } | null;
      if (!person) return { error: `No account found for @${username}.` };
      const dupe = participants.find((x) => x.user_id === person.id && x.id !== p.id);
      if (dupe) return { error: `@${username} is already in this tournament${dupe.name === `@${username}` ? "" : ` as ${dupe.name}`}.` };
      return save(p.id, { user_id: person.id, name: `@${username}` });
    }, `Invitation sent to @${username}. Their results count once they accept.`);
  }

  function unlink(p: ParticipantRow) {
    void run(() => save(p.id, { user_id: null }), `${p.name} is now a plain name. You can rename it.`);
  }

  function reinvite(p: ParticipantRow) {
    const uid = p.user_id;
    if (!uid) return;
    // Unlinking and linking again is what asks the person a second time.
    void run(async () => {
      const cleared = await save(p.id, { user_id: null });
      if ("error" in cleared) return cleared;
      return save(p.id, { user_id: uid });
    }, `Invitation sent again to ${p.name}.`);
  }

  return (
    <section aria-labelledby="entrants-h" className="p-5 sm:p-6">
      <h3 id="entrants-h" className="font-display text-2xl font-bold">
        Entrants
      </h3>
      <p className="mt-1 text-muted">Fix a spelling, or link someone to their account so their record follows them.</p>
      <ul className="mt-4 divide-y divide-border rounded-2xl border border-border">
        {participants.map((p) => {
          const label = p.user_id && p.link_status && p.link_status !== "none" ? LINK_LABEL[p.link_status] : null;
          const open = editing?.id === p.id ? editing : null;
          return (
            <li key={p.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                {label && (
                  <span className="rounded-full border border-border-strong px-2.5 py-0.5 text-xs text-muted">{label}</span>
                )}
                {!open && (
                  <span className="flex flex-wrap gap-2">
                    {!p.user_id && (
                      <button type="button" disabled={busy} onClick={() => setEditing({ id: p.id, mode: "rename", value: p.name })} aria-label={`Rename ${p.name}`} className={SMALL_BTN}>
                        Rename
                      </button>
                    )}
                    <button type="button" disabled={busy} onClick={() => setEditing({ id: p.id, mode: "link", value: "" })} aria-label={p.user_id ? `Change account for ${p.name}` : `Link ${p.name} to an account`} className={SMALL_BTN}>
                      {p.user_id ? "Change account" : "Link account"}
                    </button>
                    {p.link_status === "declined" && (
                      <button type="button" disabled={busy} onClick={() => reinvite(p)} aria-label={`Invite ${p.name} again`} className={SMALL_BTN}>
                        Invite again
                      </button>
                    )}
                    {p.user_id && (
                      <button type="button" disabled={busy} onClick={() => unlink(p)} aria-label={`Remove link from ${p.name}`} className={SMALL_BTN}>
                        Remove link
                      </button>
                    )}
                  </span>
                )}
              </div>
              {open && (
                <form
                  className="mt-3 flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (open.mode === "rename") rename(p, open.value);
                    else link(p, open.value);
                  }}
                >
                  <input
                    autoFocus
                    value={open.value}
                    onChange={(e) => setEditing({ ...open, value: e.target.value })}
                    aria-label={open.mode === "rename" ? `New name for ${p.name}` : `Username to link to ${p.name}`}
                    placeholder={open.mode === "rename" ? "New name" : "@username"}
                    maxLength={40}
                    className={FIELD}
                  />
                  <span className="flex gap-2">
                    <button type="submit" disabled={busy} className={`${PRIMARY_BTN} py-3`}>
                      {open.mode === "rename" ? "Save" : "Send invitation"}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setEditing(null)} className={`${SMALL_BTN} py-3`}>
                      Cancel
                    </button>
                  </span>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      <NoticeLine notice={notice} />
    </section>
  );
}

const VISIBILITY_OPTIONS: { id: Tournament["visibility"]; label: string; hint: string }[] = [
  { id: "public", label: "Public", hint: "Listed on the site and in rankings." },
  { id: "unlisted", label: "Link only", hint: "Not listed. Anyone with the link can follow it." },
  { id: "private", label: "Private", hint: "Only you and your scorekeepers, signed in." },
];

function VisibilityPanel({
  visibility,
  onChange,
}: {
  visibility: Tournament["visibility"];
  onChange: (next: Tournament["visibility"]) => Promise<string | null>;
}) {
  const [pending, setPending] = useState<Tournament["visibility"] | null>(null); // awaiting confirmation
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function apply(next: Tournament["visibility"]) {
    setBusy(true);
    setNotice(null);
    const error = await onChange(next);
    setBusy(false);
    setPending(null);
    setNotice(error ? { kind: "error", text: error } : { kind: "ok", text: "Visibility updated." });
  }

  function choose(next: Tournament["visibility"]) {
    if (next === visibility || busy) return;
    setNotice(null);
    // Going private hides it from everyone else straight away, so ask first.
    if (next === "private") setPending(next);
    else void apply(next);
  }

  return (
    <section aria-labelledby="vis-h" className="p-5 sm:p-6">
      <h3 id="vis-h" className="font-display text-2xl font-bold">
        Who can see it
      </h3>
      <div role="radiogroup" aria-labelledby="vis-h" className="mt-4 grid gap-3 sm:grid-cols-3">
        {VISIBILITY_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={o.id === visibility}
            disabled={busy}
            onClick={() => choose(o.id)}
            className={`cursor-pointer rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
              o.id === visibility ? "border-primary bg-primary/5" : "border-border bg-surface hover:border-border-strong"
            }`}
          >
            <span className="block font-display text-xl font-bold">{o.label}</span>
            <span className="mt-1 block text-sm text-muted">{o.hint}</span>
          </button>
        ))}
      </div>
      {pending && (
        <div role="alertdialog" aria-label="Confirm making it private" className="mt-4 rounded-2xl border border-loss/40 bg-loss/10 p-4">
          <p className="text-sm">
            Make this tournament private? It will disappear from the home page and rankings, and anyone who isn&apos;t
            you or a scorekeeper will no longer be able to open it.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={busy} onClick={() => apply("private")} className={PRIMARY_BTN}>
              Make private
            </button>
            <button type="button" disabled={busy} onClick={() => setPending(null)} className={SMALL_BTN}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <NoticeLine notice={notice} />
    </section>
  );
}

function ManagePanel({
  demo,
  tournament,
  status,
  unplayed,
  total,
  leaderName,
  onChangeStatus,
  visibility,
  onChangeVisibility,
  participants,
  onParticipantChange,
  onDelete,
  archive,
  extra,
}: {
  demo: boolean;
  archive: { mode: ArchiveMode; archived: boolean; due: Date | null; onChange: (next: ArchiveMode) => Promise<string | null> };
  onDelete: () => Promise<string | null>;
  participants: ParticipantRow[];
  onParticipantChange: (row: ParticipantRow) => void;
  tournament: Tournament;
  visibility: Tournament["visibility"];
  onChangeVisibility: (next: Tournament["visibility"]) => Promise<string | null>;
  status: Tournament["status"];
  unplayed: number;
  total: number;
  leaderName: string | null;
  onChangeStatus: (next: "live" | "finished") => Promise<string | null>;
  extra?: React.ReactNode;
}) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <SharePanel slug={tournament.slug} visibility={visibility} />
      <VisibilityPanel visibility={visibility} onChange={onChangeVisibility} />
      <ScorekeepersPanel demo={demo} tournamentId={tournament.id} />
      {!demo && <EntrantsPanel participants={participants} onChange={onParticipantChange} />}
      {extra}
      {!demo && <ArchivePanel {...archive} />}
      {!demo && <DeletePanel name={tournament.name} onDelete={onDelete} />}
      <FinishPanel status={status} unplayed={unplayed} total={total} leaderName={leaderName} onChangeStatus={onChangeStatus} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type TabId = "standings" | "bracket" | "fixtures" | "manage";
const TABS: { id: TabId; label: string }[] = [
  { id: "standings", label: "Standings" },
  { id: "fixtures", label: "Fixtures" },
];

/**
 * Private tournaments can't be read by the server (it fetches as an anonymous visitor), so the page hands
 * those slugs to this component, which asks again from the browser with the signed-in session.
 */
export function TournamentGate({ slug }: { slug: string }) {
  const { user, loading } = useUser();
  const userId = user?.id ?? null;
  const [result, setResult] = useState<
    { key: string; bundle: TournamentBundle | null; error: string | null } | null
  >(null);
  const key = `${slug}:${userId ?? "anon"}`;

  useEffect(() => {
    if (loading) return;
    let active = true;
    getTournamentBundle(slug)
      .then((bundle) => active && setResult({ key, bundle, error: null }))
      .catch((e) => active && setResult({ key, bundle: null, error: e instanceof Error ? e.message : "Unknown error" }));
    return () => {
      active = false;
    };
  }, [loading, slug, key]);

  if (loading || !result || result.key !== key) {
    return <div aria-busy="true" aria-label="Loading tournament" className="mx-auto max-w-5xl px-4 py-16 sm:px-6"><div className="skeleton h-40 rounded-2xl" /></div>;
  }
  if (result.bundle) return <TournamentView key={result.bundle.tournament.id} initial={result.bundle} demo={false} />;

  return (
    <main className="bg-floodlight min-h-[calc(100dvh-3.5rem)] px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-xl">
        <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-7xl">
          {result.error ? "Couldn't load it" : "Tournament not found"}
        </h1>
        <p role={result.error ? "alert" : undefined} className="mt-5 text-lg text-muted">
          {result.error
            ? result.error
            : userId
              ? "This link may be wrong, or it is a private tournament and this account isn't an organizer or scorekeeper."
              : "This link may be wrong, or the tournament is private. If it's yours, sign in to open it."}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {!userId && (
            <Link
              href={`/auth?next=/tournaments/${slug}`}
              className="inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:shadow-glow-lime"
            >
              Sign in
            </Link>
          )}
          <Link href="/" className="inline-flex rounded-full border border-border-strong px-6 py-3 font-semibold transition hover:border-foreground">
            Back home
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function TournamentView({ initial, demo }: { initial: TournamentBundle; demo: boolean }) {
  const { tournament } = initial;
  const [participants, setParticipants] = useState<ParticipantRow[]>(initial.participants);
  const game = tournament.game;

  const [matches, setMatches] = useState<MatchRow[]>(initial.matches);
  const [tab, setTab] = useState<TabId>(tournament.format === "knockout" ? "bracket" : "standings");
  const [stage, setStage] = useState<"groups" | "knockout">(
    tournament.format === "groups_knockout" && initial.matches.some((m) => m.group_label === null) ? "knockout" : "groups",
  );
  const [status, setStatus] = useState<Tournament["status"]>(tournament.status);
  const [visibility, setVisibility] = useState<Tournament["visibility"]>(tournament.visibility);
  const [archiveMode, setArchiveMode] = useState<ArchiveMode>(tournament.archive_mode ?? "auto");
  const [finishedAt, setFinishedAt] = useState<string | null>(tournament.finished_at ?? null);
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
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tournaments", filter: `id=eq.${tournament.id}` },
        (payload) => {
          const row = payload.new as { status?: Tournament["status"]; visibility?: Tournament["visibility"] };
          if (row.status) setStatus(row.status);
          if (row.visibility) setVisibility(row.visibility);
        },
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [demo, tournament.id]);

  // Who is signed in, and may they enter scores here? The database enforces this too; this only decides
  // whether to show the controls.
  const { user } = useUser();
  const userId = user?.id;
  const [roleResult, setRoleResult] = useState<{ key: string; role: "owner" | "scorekeeper" | null } | null>(null);
  const roleKey = userId ? `${userId}:${tournament.id}` : "";

  useEffect(() => {
    if (demo || !hasSupabase || !userId) return;
    let active = true;
    getSupabase()
      .from("tournament_admins")
      .select("role")
      .eq("tournament_id", tournament.id)
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const role = (data?.role as "owner" | "scorekeeper" | undefined) ?? null;
        setRoleResult({ key: `${userId}:${tournament.id}`, role });
      });
    return () => {
      active = false;
    };
  }, [demo, userId, tournament.id]);

  const role = roleResult && roleResult.key === roleKey ? roleResult.role : null;
  const canScore = demo || role !== null;
  const isOwner = demo || role === "owner";

  const isKnockout = tournament.format === "knockout";
  const isGroups = tournament.format === "groups_knockout";
  const advance = tournament.advance_per_group ?? 2;
  /** True for every match of a knockout, and for the bracket matches (no group) of groups-then-knockout. */
  const inKnockout = (m: MatchRow) => isKnockout || (isGroups && m.group_label === null);
  const koStarted = isGroups && matches.some((m) => m.group_label === null);

  // The database trigger moves a knockout winner on and finishes the tournament after the final.
  // This mirrors that on screen straight away instead of waiting for the live update to arrive.
  function mirrorFinal(current: MatchRow, patch: ScorePatch) {
    if (!inKnockout(current) || current.next_match_id !== null || patch.status === undefined) return;
    if (patch.status === "finished") setStatus((s) => (s === "live" ? "finished" : s));
    else if (current.status === "finished") setStatus((s) => (s === "finished" ? "live" : s));
  }

  async function saveMatch(id: string, patch: ScorePatch): Promise<string | null> {
    const current = matches.find((m) => m.id === id);
    if (!current) return "This match is no longer part of the tournament. Reload the page.";
    const next = { ...current, ...patch };
    const knock = inKnockout(current);

    if (knock) {
      const checked = advanceKnockout(matches, id, patch);
      if (checked.error) return checked.error;
    } else {
      if (isGroups && koStarted) return "Group results are locked once the knockout stage has started.";
      if (next.status === "finished") {
        if (next.home_score === null || next.away_score === null) return "Enter both scores first.";
        if (!game.allows_draws && next.home_score === next.away_score) {
          return `${game.name} has no draws, so one side has to be ahead before full time.`;
        }
      }
    }

    if (!demo) {
      const { data, error } = await getSupabase().from("matches").update(patch).eq("id", id).select("id");
      if (error) return error.message;
      // A blocked update is not an error in Postgres, it just changes nothing.
      if (!data || data.length === 0) {
        return "You can't change scores in this tournament. Sign in as the organizer and try again.";
      }
    }
    // Apply to the latest state, not the copy from when the save started, so live updates that arrived meanwhile survive.
    setMatches((ms) => (knock ? advanceKnockout(ms, id, patch).rows : ms.map((m) => (m.id === id ? { ...m, ...patch } : m))));
    mirrorFinal(current, patch);
    return null;
  }

  async function changeStatus(next: "live" | "finished"): Promise<string | null> {
    if (!demo) {
      const { data, error } = await getSupabase().from("tournaments").update({ status: next }).eq("id", tournament.id).select("id");
      if (error) return error.message;
      if (!data || data.length === 0) return "Only the organizer can do that. Sign in as the organizer and try again.";
    }
    setStatus(next);
    return null;
  }

  const nameById = useMemo(() => new Map(participants.map((p) => [p.id, p.name])), [participants]);
  const nameOf = (id: string | null) => (id ? (nameById.get(id) ?? "Unknown") : "To be decided");

  const rules: GameRules = useMemo(
    () => ({ allowsDraws: game.allows_draws, ptsWin: game.pts_win, ptsDraw: game.pts_draw, ptsLoss: game.pts_loss }),
    [game],
  );

  const results = useMemo<MatchResult[]>(
    () =>
      matches
        // Groups-then-knockout: only group matches feed the tables.
        .filter((m) => m.home_id && m.away_id && (!isGroups || m.group_label !== null))
        .map((m) => ({
          home: m.home_id as string,
          away: m.away_id as string,
          homeScore: m.home_score,
          awayScore: m.away_score,
          status: m.status,
        })),
    [matches, isGroups],
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

  const knockoutRows = useMemo(
    () => (isKnockout ? matches : isGroups ? matches.filter((m) => m.group_label === null) : []),
    [isKnockout, isGroups, matches],
  );
  const bracket = useMemo(() => (knockoutRows.length > 0 ? layoutBracket(knockoutRows) : null), [knockoutRows]);
  const knockoutChampionId = bracket ? knockoutWinner(bracket.final) : null;
  const hasBracketTab = isKnockout || isGroups;

  const leader = tables.length === 1 && !isKnockout ? tables[0].rows[0] : undefined;
  const leaderName = leader && leader.played > 0 ? nameOf(leader.id) : null;
  const champion = status === "finished" && tournament.format === "round_robin" && leader && leader.played > 0 ? leader : null;
  const unplayed = matches.filter((m) => m.status !== "finished").length;
  const baseTabs: { id: TabId; label: string }[] = isKnockout
    ? [
        { id: "bracket", label: "Bracket" },
        { id: "fixtures", label: "Fixtures" },
      ]
    : isGroups
      ? [
          { id: "standings", label: "Groups" },
          { id: "bracket", label: "Knockout" },
          { id: "fixtures", label: "Fixtures" },
        ]
      : TABS;
  const tabs: { id: TabId; label: string }[] = isOwner ? [...baseTabs, { id: "manage", label: "Manage" }] : baseTabs;
  const totalRounds = knockoutRows.reduce((n, m) => Math.max(n, m.round), 0);
  const roundLabel = (r: number) =>
    isKnockout || (isGroups && stage === "knockout") ? roundName(r, totalRounds) : isGroups ? `Matchday ${r}` : `Round ${r}`;
  const fixtureMatches = isGroups ? matches.filter((m) => (stage === "knockout" ? m.group_label === null : m.group_label !== null)) : matches;

  const groupRemaining = isGroups ? matches.filter((m) => m.group_label !== null && m.status !== "finished").length : 0;
  const koPreview = (() => {
    if (!isGroups || koStarted || groupRemaining > 0) return null;
    const seeds = seedQualifiers(tables, advance);
    if (seeds.length < 2) return null;
    const draw = generateKnockout(seeds);
    return {
      pairs: draw.matches.filter((m) => m.round === 1).map((m) => ({ home: nameOf(m.home), away: nameOf(m.away) })),
      byes: draw.byes.map((id) => nameOf(id)),
    };
  })();

  async function startKnockout(): Promise<string | null> {
    if (!isGroups || koStarted) return "The knockout stage has already been drawn.";
    const seeds = seedQualifiers(tables, advance);
    if (seeds.length < 2) return "Not enough teams qualified to draw a knockout.";
    const draw = generateKnockout(seeds);
    const idOf = new Map(draw.matches.map((m) => [m.key, crypto.randomUUID()]));
    const rows: MatchRow[] = draw.matches.map((m) => ({
      id: idOf.get(m.key) as string,
      tournament_id: tournament.id,
      round: m.round,
      group_label: null,
      home_id: m.home,
      away_id: m.away,
      home_score: null,
      away_score: null,
      status: "scheduled",
      scheduled_at: null,
      next_match_id: m.next ? (idOf.get(m.next.key) as string) : null,
      next_slot: m.next ? m.next.slot : null,
    }));
    if (!demo) {
      const { error } = await getSupabase()
        .from("matches")
        .insert(
          rows.map((r) => ({
            id: r.id,
            tournament_id: r.tournament_id,
            round: r.round,
            home_id: r.home_id,
            away_id: r.away_id,
            next_match_id: r.next_match_id,
            next_slot: r.next_slot,
            status: "scheduled",
          })),
        );
      if (error) return error.code === "42501" ? "Only the organizer can draw the knockout stage." : error.message;
    }
    // A live update may have delivered some of these rows already, so add only the missing ones.
    setMatches((ms) => {
      const have = new Set(ms.map((m) => m.id));
      return [...ms, ...rows.filter((r) => !have.has(r.id))];
    });
    setStage("knockout");
    setTab("bracket");
    return null;
  }

  const played = matches.filter((m) => m.status === "finished").length;
  const pct = matches.length ? Math.round((played / matches.length) * 100) : 0;
  const isEsports = game.category === "esports";
  const accent = isEsports ? "text-esports border-esports/30 bg-esports/10" : "text-sports border-sports/30 bg-sports/10";

  function playNextMatch() {
    const next = [...matches]
      .sort((a, b) => Number(a.group_label === null && isGroups) - Number(b.group_label === null && isGroups) || a.round - b.round)
      .find((m) => m.status !== "finished" && m.home_id && m.away_id);
    if (!next) return;
    const knock = inKnockout(next);
    let h = Math.floor(Math.random() * 5);
    const a = Math.floor(Math.random() * 4);
    if (h === a && (knock || !game.allows_draws)) h++;
    const patch: ScorePatch = { status: "finished", home_score: h, away_score: a };
    setMatches((ms) => (knock ? advanceKnockout(ms, next.id, patch).rows : ms.map((m) => (m.id === next.id ? { ...m, ...patch } : m))));
    mirrorFinal(next, patch);
  }

  const router = useRouter();

  // The database stamps finished_at when a tournament finishes; mirror that here so the page agrees
  // without a reload (a tournament finished a moment ago is not archived yet).
  useEffect(() => {
    setFinishedAt((f) => (status === "finished" ? (f ?? new Date().toISOString()) : null));
  }, [status]);
  const archiveInfo = { archive_mode: archiveMode, status, finished_at: finishedAt };
  const archived = isArchived(archiveInfo);
  const archiveDue = archiveDueAt(archiveInfo);

  async function changeArchiveMode(next: ArchiveMode): Promise<string | null> {
    const { data, error } = await getSupabase().from("tournaments").update({ archive_mode: next }).eq("id", tournament.id).select("id");
    if (error) return error.message;
    if (!data || data.length === 0) return "Couldn't change it. Only the organizer can do that.";
    setArchiveMode(next);
    return null;
  }

  /** Deletes the tournament and everything in it. Returns an error message, or null after leaving the page. */
  async function deleteTournament(): Promise<string | null> {
    const { data, error } = await getSupabase().from("tournaments").delete().eq("id", tournament.id).select("id");
    if (error) return error.message;
    if (!data || data.length === 0) return "Couldn't delete it. Only the organizer can do that.";
    router.push("/my-tournaments");
    return null;
  }

  async function changeVisibility(next: Tournament["visibility"]): Promise<string | null> {
    if (demo) {
      setVisibility(next);
      return null;
    }
    // .select() so a change the database silently refused (0 rows) is reported instead of looking saved.
    const { data, error } = await getSupabase().from("tournaments").update({ visibility: next }).eq("id", tournament.id).select("id");
    if (error) return error.message;
    if (!data || data.length === 0) return "Couldn't change visibility. Only the organizer can do that.";
    setVisibility(next);
    return null;
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
            {status === "live" && (
              <span className="flex items-center gap-2 rounded-full border border-live/30 bg-live/10 px-3 py-1 font-medium text-live">
                <LiveDot />
                Live now
              </span>
            )}
            {status === "finished" && (
              <span className="rounded-full border border-border bg-surface-raised px-3 py-1 text-muted">Finished</span>
            )}
            {archived && (
              <span className="rounded-full border border-border bg-surface-raised px-3 py-1 text-muted">Archived</span>
            )}
            {visibility !== "public" && (
              <span className="rounded-full border border-border bg-surface-raised px-3 py-1 text-muted">
                {visibility === "private" ? "Private" : "Link only"}
              </span>
            )}
            {status === "draft" && (
              <span className="rounded-full border border-border bg-surface-raised px-3 py-1 text-muted">Not started</span>
            )}
          </div>

          <h1 className="mt-5 font-display text-6xl font-extrabold leading-[0.9] tracking-tight sm:text-8xl">
            {tournament.name}
          </h1>

          <p className="mt-4 max-w-prose text-muted">
            {FORMAT_LABEL[tournament.format]}
            {tournament.format !== "knockout" && tournament.double_round ? ", home and away" : ""} with{" "}
            {participants.length} {isEsports ? "players" : "teams"}
            {isGroups ? `, top ${advance} from each group go through` : ""}.
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
            <span>This is demo data. Score a match yourself in the Fixtures tab, or press Play next match.</span>
            <button
              onClick={playNextMatch}
              disabled={nothingLeft}
              className="cursor-pointer rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground transition hover:shadow-glow-lime disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {nothingLeft ? (isGroups && !koStarted ? "Groups complete" : "All matches played") : "Play next match"}
            </button>
          </div>
        )}

        {!demo && role && (
          <p className="mb-6 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-muted">
            You are {role === "owner" ? "the organizer" : "a scorekeeper"} of this tournament. Open the Fixtures tab to
            enter scores. Everyone watching sees each change as you save it.
            {role === "owner" && " Use the Manage tab to share the link, add scorekeepers or end the tournament."}
          </p>
        )}

        <div
          role="tablist"
          aria-label="Tournament views"
          className="mb-6 flex gap-0 overflow-x-auto border-b border-border [scrollbar-width:none] sm:gap-1 [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`relative shrink-0 cursor-pointer whitespace-nowrap px-3 py-3 font-display text-xl font-semibold transition-colors sm:px-4 ${
                  active ? "text-foreground" : "text-subtle hover:text-muted"
                }`}
              >
                {t.label}
                {active && (
                  <motion.span
                    layoutId="tab-underline"
                    className="absolute inset-x-3 bottom-0 h-0.5 rounded bg-primary shadow-glow-lime"
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
            {tab === "bracket" && hasBracketTab ? (
              bracket ? (
                <div className="space-y-6">
                  {knockoutChampionId && (
                    <ChampionBanner
                      name={nameOf(knockoutChampionId)}
                      detail={`Won the ${tournament.name}${totalRounds > 1 ? ` after ${totalRounds} rounds` : ""}.`}
                    />
                  )}
                  <Bracket
                    layout={bracket}
                    nameOf={nameOf}
                    champion={knockoutChampionId ? nameOf(knockoutChampionId) : null}
                    mounted={mounted}
                    intro={intro.current}
                  />
                  {canScore && (
                    <p className="text-sm text-subtle">
                      Enter scores in the Fixtures tab. Winners move into the next round on their own. A knockout match
                      can&apos;t end level, so count extra time or penalties in the score.
                    </p>
                  )}
                </div>
              ) : isGroups ? (
                <div className="rounded-2xl border border-dashed border-border-strong px-5 py-10 text-muted">
                  <p className="font-display text-2xl font-bold text-foreground">The knockout hasn&apos;t started.</p>
                  <p className="mt-1 max-w-prose">
                    {groupRemaining > 0
                      ? `It is drawn once every group match is played. ${groupRemaining} ${groupRemaining === 1 ? "match is" : "matches are"} still to go.`
                      : isOwner
                        ? "Every group match is played. Open the Manage tab to draw the knockout stage."
                        : "Every group match is played. The organizer will draw the knockout stage next."}
                  </p>
                </div>
              ) : (
                <p className="rounded-2xl border border-dashed border-border-strong px-5 py-10 text-muted">
                  The bracket isn&apos;t available for this tournament. The Fixtures tab lists every match.
                </p>
              )
            ) : tab === "standings" ? (
              participants.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border-strong px-5 py-10 text-muted">
                  No teams yet. Add teams to this tournament to start the table.
                </p>
              ) : (
                <div className="space-y-8">
                  {champion && (
                    <ChampionBanner
                      name={nameOf(champion.id)}
                      detail={`Champions with ${champion.points} points from ${champion.played} ${champion.played === 1 ? "match" : "matches"}.`}
                    />
                  )}
                  {isGroups && knockoutChampionId && (
                    <ChampionBanner name={nameOf(knockoutChampionId)} detail={`Won the ${tournament.name}.`} />
                  )}
                  {tables.map((t) => (
                    <StandingsTable
                      key={t.label}
                      title={t.label || undefined}
                      rows={t.rows}
                      nameOf={(id) => nameOf(id)}
                      intro={intro.current}
                      qualify={isGroups ? advance : undefined}
                    />
                  ))}
                  <p className="text-sm text-subtle">
                    Ranked by points, then goal difference, then {game.score_label.toLowerCase()} scored, then results
                    between the tied teams.
                    {isGroups && ` The top ${advance} in each group go through to the knockout.`}
                  </p>
                </div>
              )
            ) : tab === "manage" && isOwner ? (
              <ManagePanel
                demo={demo}
                tournament={tournament}
                status={status}
                unplayed={unplayed}
                total={matches.length}
                leaderName={hasBracketTab ? (status === "finished" && knockoutChampionId ? nameOf(knockoutChampionId) : null) : leaderName}
                onChangeStatus={changeStatus}
                visibility={visibility}
                onChangeVisibility={changeVisibility}
                participants={participants}
                onDelete={deleteTournament}
                archive={{ mode: archiveMode, archived, due: archiveDue, onChange: changeArchiveMode }}
                onParticipantChange={(row) => setParticipants((ps) => ps.map((p) => (p.id === row.id ? { ...p, ...row } : p)))}
                extra={
                  isGroups ? (
                    <KnockoutStagePanel
                      started={koStarted}
                      remaining={groupRemaining}
                      advance={advance}
                      preview={koPreview}
                      onDraw={startKnockout}
                    />
                  ) : undefined
                }
              />
            ) : (
              <div>
                {isGroups && (
                  <div role="group" aria-label="Stage" className="mb-4 flex gap-2">
                    {(["groups", "knockout"] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        aria-pressed={stage === st}
                        onClick={() => setStage(st)}
                        className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-medium transition ${
                          stage === st ? "border-primary text-primary" : "border-border-strong text-muted hover:text-foreground"
                        }`}
                      >
                        {st === "groups" ? "Group stage" : "Knockout"}
                      </button>
                    ))}
                  </div>
                )}
                <Fixtures
                  key={stage}
                  matches={fixtureMatches}
                  participants={participants}
                  nameOf={nameOf}
                  scoreLabel={game.score_label}
                  showTime={mounted}
                  canScore={canScore}
                  onSave={saveMatch}
                  roundLabel={roundLabel}
                  showResting={!isKnockout && !isGroups}
                />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </MotionConfig>
  );
}
