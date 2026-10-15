"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  MAX_ADVANCE,
  MAX_GROUPS,
  assignGroups,
  generateGroupStage,
  generateKnockout,
  generateRoundRobin,
  groupPlanProblem,
  roundName,
} from "@/lib/tournament";
import { getSupabase, hasSupabase, type Game } from "@/lib/supabase";
import { useUser } from "@/lib/use-user";

// ---------------------------------------------------------------------------
// Types, constants, helpers
// ---------------------------------------------------------------------------

type Org = { id: string; name: string; type: string };
type Visibility = "public" | "unlisted" | "private";

const STEPS = ["Game", "Teams", "Details", "Review"] as const;
const NEW_ORG = "__new__";
const MAX_ENTRANTS = 32;
const MAX_NAME = 40;

const INPUT =
  "w-full rounded-xl border border-border bg-surface-sunken px-4 py-3 outline-none transition placeholder:text-subtle focus:border-primary";
const FOCUS_RING = "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring";

const FORMATS = [
  { id: "round_robin", label: "Round robin", hint: "Everyone plays everyone. Ranked in a league table.", ready: true },
  { id: "knockout", label: "Knockout", hint: "Lose and you're out. Ends in a final.", ready: true },
  { id: "groups_knockout", label: "Groups, then knockout", hint: "Group tables first, then a bracket.", ready: true },
] as const;

const VISIBILITY: { id: Visibility; label: string; hint: string; ready: boolean }[] = [
  { id: "public", label: "Public", hint: "Listed on the site. Anyone can follow it.", ready: true },
  { id: "unlisted", label: "Link only", hint: "Not listed. Anyone with the link can follow it.", ready: true },
  { id: "private", label: "Private", hint: "Only you and your scorekeepers can see it. Sign-in required.", ready: true },
];

function slugify(text: string) {
  const base = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base || "tournament";
}

const suffix = () => Math.random().toString(36).slice(2, 6);

/** One name per line (commas and semicolons also separate). Repeats are dropped, over-long names block. */
function parseNames(text: string) {
  const seen = new Set<string>();
  const names: string[] = [];
  const repeated: string[] = [];
  const tooLong: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name) continue;
    if (name.length > MAX_NAME) {
      tooLong.push(name);
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      repeated.push(name);
      continue;
    }
    seen.add(key);
    names.push(name);
  }
  return { names, repeated, tooLong };
}

/** Deterministic shuffle (mulberry32) so render stays pure; the random seed is picked in the click handler. */
function shuffled<T>(items: T[], seed: number): T[] {
  const a = [...items];
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function readableError(e: unknown) {
  const err = e as { message?: string; code?: string } | null;
  if (err?.code === "42501") return "You don't have permission to do that. Sign out, sign in again, and retry.";
  return err?.message || "Something went wrong. Nothing was saved, so you can try again.";
}

function describeGame(g: Game) {
  return `Scored in ${g.score_label.toLowerCase()}. ${g.allows_draws ? "Draws allowed" : "No draws"}. A win earns ${g.pts_win} points.`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NewTournamentPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();

  // data
  const [games, setGames] = useState<Game[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // wizard
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [gameId, setGameId] = useState("");
  const [name, setName] = useState("");
  const [format, setFormat] = useState<(typeof FORMATS)[number]["id"]>("round_robin");
  const [doubleRound, setDoubleRound] = useState(false);
  const [groupCount, setGroupCount] = useState(2);
  const [advance, setAdvance] = useState(2);
  const [teamsText, setTeamsText] = useState("");
  const [shuffleKey, setShuffleKey] = useState(0);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [orgChoice, setOrgChoice] = useState("");
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgType, setNewOrgType] = useState("department");
  const [startsAt, setStartsAt] = useState("");

  // saving
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (!hasSupabase) return;
    const sb = getSupabase();
    let active = true;
    Promise.all([
      sb
        .from("games")
        .select("id, slug, name, category, score_label, allows_draws, pts_win, pts_draw, pts_loss")
        .order("name"),
      sb.from("organizations").select("id, name, type").order("name"),
    ]).then(([g, o]) => {
      if (!active) return;
      if (g.error) setLoadError(g.error.message);
      else setGames((g.data ?? []) as Game[]);
      if (!o.error) setOrgs((o.data ?? []) as Org[]);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Move keyboard focus to the new step's heading so screen readers announce the change.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const game = games.find((g) => g.id === gameId);
  const entrant = game?.category === "esports" ? "player" : "team";
  const parsed = useMemo(() => parseNames(teamsText), [teamsText]);
  const ordered = useMemo(
    () => (shuffleKey === 0 ? parsed.names : shuffled(parsed.names, shuffleKey)),
    [parsed.names, shuffleKey],
  );

  const planProblem = format === "groups_knockout" ? groupPlanProblem(ordered.length, groupCount, advance) : null;

  const valid = [
    gameId !== "" && name.trim().length >= 3 && name.trim().length <= 60,
    ordered.length >= 2 &&
      ordered.length <= MAX_ENTRANTS &&
      parsed.tooLong.length === 0 &&
      (format !== "groups_knockout" || planProblem === null),
    orgChoice !== NEW_ORG || newOrgName.trim().length >= 2,
    true,
  ];

  const schedule = useMemo(() => {
    if (step !== 3 || ordered.length < 2) return null;
    const indexes = ordered.map((_, i) => String(i));
    const rounds = new Map<number, { home: string; away: string; tag?: string }[]>();
    if (format === "knockout") {
      const draw = generateKnockout(indexes);
      const waiting = "Winner of an earlier match";
      for (const m of draw.matches) {
        const list = rounds.get(m.round) ?? [];
        list.push({ home: m.home ? ordered[Number(m.home)] : waiting, away: m.away ? ordered[Number(m.away)] : waiting });
        rounds.set(m.round, list);
      }
      return {
        rounds: [...rounds.entries()].sort(([a], [b]) => a - b).map(([r, ms]) => [r, ms, roundName(r, draw.rounds)] as const),
        total: draw.matches.length,
        byes: draw.byes.map((i) => ordered[Number(i)]),
      };
    }
    if (format === "groups_knockout") {
      if (groupPlanProblem(ordered.length, groupCount, advance) !== null) return null;
      const split = assignGroups(indexes, groupCount);
      const stage = generateGroupStage(split, { doubleRound });
      for (const f of stage.fixtures) {
        const list = rounds.get(f.round) ?? [];
        list.push({ home: ordered[Number(f.home)], away: ordered[Number(f.away)], tag: `Group ${f.group}` });
        rounds.set(f.round, list);
      }
      return {
        rounds: [...rounds.entries()].sort(([a], [b]) => a - b).map(([r, ms]) => [r, ms, `Matchday ${r}`] as const),
        total: stage.fixtures.length,
        byes: [] as string[],
        groups: split.map((g) => ({ label: g.label, names: g.ids.map((i) => ordered[Number(i)]) })),
        note: `${groupCount * advance} teams reach the knockout, drawn once the group matches are played.`,
      };
    }
    const result = generateRoundRobin(indexes, { doubleRound });
    for (const f of result.fixtures) {
      const list = rounds.get(f.round) ?? [];
      list.push({ home: ordered[Number(f.home)], away: ordered[Number(f.away)] });
      rounds.set(f.round, list);
    }
    return {
      rounds: [...rounds.entries()].sort(([a], [b]) => a - b).map(([r, ms]) => [r, ms, `Round ${r}`] as const),
      total: result.fixtures.length,
      byes: [] as string[],
    };
  }, [step, ordered, doubleRound, format, groupCount, advance]);

  function go(to: number) {
    setDirection(to > step ? 1 : -1);
    setStep(to);
  }

  async function create() {
    if (!user || !game) return;
    setBusy(true);
    setError(null);
    const sb = getSupabase();

    // Ids are made here, not read back from the database, so no insert needs a RETURNING row.
    const tournamentId = crypto.randomUUID();
    try {
      let orgId: string | null = orgChoice && orgChoice !== NEW_ORG ? orgChoice : null;
      if (orgChoice === NEW_ORG) {
        orgId = crypto.randomUUID();
        const { error } = await sb.from("organizations").insert({
          id: orgId,
          name: newOrgName.trim(),
          slug: `${slugify(newOrgName)}-${suffix()}`,
          type: newOrgType,
          created_by: user.id,
        });
        if (error) throw error;
      }

      let slug = "";
      for (let attempt = 0; ; attempt++) {
        slug = `${slugify(name)}-${suffix()}`;
        const { error } = await sb.from("tournaments").insert({
          id: tournamentId,
          slug,
          name: name.trim(),
          game_id: game.id,
          owner_id: user.id,
          org_id: orgId,
          format,
          double_round: format !== "knockout" && doubleRound,
          ...(format === "groups_knockout" ? { advance_per_group: advance } : {}),
          status: "live",
          visibility,
          starts_at: startsAt ? new Date(startsAt).toISOString() : null,
        });
        if (!error) break;
        if (error.code !== "23505" || attempt >= 2) throw error; // 23505 = slug already taken, try another
      }

      const participants: { id: string; tournament_id: string; name: string; seed: number; group_label?: string }[] =
        ordered.map((n, i) => ({
          id: crypto.randomUUID(),
          tournament_id: tournamentId,
          name: n,
          seed: i + 1,
        }));
      const groupSplit = format === "groups_knockout" ? assignGroups(participants.map((x) => x.id), groupCount) : null;
      if (groupSplit) {
        for (const g of groupSplit) for (const id of g.ids) participants.find((x) => x.id === id)!.group_label = g.label;
      }
      const p = await sb.from("participants").insert(participants);
      if (p.error) throw p.error;

      let rows: Record<string, unknown>[];
      if (format === "knockout") {
        // Every match gets its id now so each can point at the match its winner moves into.
        const draw = generateKnockout(participants.map((x) => x.id));
        const idOf = new Map(draw.matches.map((x) => [x.key, crypto.randomUUID()]));
        rows = draw.matches.map((x) => ({
          id: idOf.get(x.key),
          tournament_id: tournamentId,
          round: x.round,
          home_id: x.home,
          away_id: x.away,
          next_match_id: x.next ? idOf.get(x.next.key) : null,
          next_slot: x.next ? x.next.slot : null,
          status: "scheduled",
        }));
      } else if (groupSplit) {
        // The knockout matches are made later, from the final group tables.
        rows = generateGroupStage(groupSplit, { doubleRound }).fixtures.map((f) => ({
          tournament_id: tournamentId,
          round: f.round,
          group_label: f.group,
          home_id: f.home,
          away_id: f.away,
          status: "scheduled",
        }));
      } else {
        rows = generateRoundRobin(participants.map((x) => x.id), { doubleRound }).fixtures.map((f) => ({
          tournament_id: tournamentId,
          round: f.round,
          home_id: f.home,
          away_id: f.away,
          status: "scheduled",
        }));
      }
      const m = await sb.from("matches").insert(rows);
      if (m.error) throw m.error;

      router.push(`/tournaments/${slug}`);
    } catch (e) {
      // Don't leave a half-built tournament behind. Teams and matches are removed with it.
      await sb.from("tournaments").delete().eq("id", tournamentId);
      setError(readableError(e));
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid[step]) return;
    if (step < STEPS.length - 1) go(step + 1);
    else void create();
  }

  // ---- gates -------------------------------------------------------------

  const shell = (children: React.ReactNode) => (
    <main className="bg-floodlight min-h-[calc(100dvh-3.5rem)] px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-6xl font-extrabold leading-[0.95] tracking-tight sm:text-7xl">
          Start a tournament
        </h1>
        {children}
      </div>
    </main>
  );

  if (!hasSupabase) {
    return shell(
      <p className="mt-8 rounded-2xl border border-dashed border-border-strong px-5 py-6 text-muted">
        Supabase isn&apos;t connected yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local,
        then restart the dev server.
      </p>,
    );
  }

  if (userLoading || !loaded) {
    return shell(
      <div className="mt-8 space-y-3" aria-busy="true" aria-label="Loading">
        <div className="skeleton h-10 w-2/3 rounded-xl" />
        <div className="skeleton h-28 rounded-2xl" />
        <div className="skeleton h-28 rounded-2xl" />
      </div>,
    );
  }

  if (!user) {
    return shell(
      <div className="mt-8 rounded-2xl border border-border bg-surface p-6">
        <p className="text-lg font-medium">Sign in to start a tournament.</p>
        <p className="mt-1 text-muted">Anyone can follow a tournament without an account. Running one needs one.</p>
        <Link
          href="/auth?next=/tournaments/new"
          className="mt-5 inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:shadow-glow-lime"
        >
          Sign in or create an account
        </Link>
      </div>,
    );
  }

  if (loadError) {
    return shell(
      <p role="alert" className="mt-8 rounded-xl border border-loss/40 bg-loss/10 px-4 py-3 text-loss">
        Couldn&apos;t load the list of games: {loadError}. Check that schema.sql ran fully in Supabase.
      </p>,
    );
  }

  // ---- steps -------------------------------------------------------------

  const sports = games.filter((g) => g.category === "sport");
  const esports = games.filter((g) => g.category === "esports");
  const orgName = orgChoice === NEW_ORG ? newOrgName.trim() : (orgs.find((o) => o.id === orgChoice)?.name ?? "None");
  const formatLabel = FORMATS.find((f) => f.id === format)?.label ?? "";

  const stepBody = [
    // 1. Game, name, format
    <div key="game" className="space-y-8">
      <div className="space-y-6">
        {sports.length > 0 && (
          <fieldset>
            <legend className="mb-3 font-display text-2xl font-bold">Physical sports</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {sports.map((g) => (
                <GameTile key={g.id} game={g} selected={g.id === gameId} onSelect={() => setGameId(g.id)} />
              ))}
            </div>
          </fieldset>
        )}
        {esports.length > 0 && (
          <fieldset>
            <legend className="mb-3 font-display text-2xl font-bold">Esports</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {esports.map((g) => (
                <GameTile key={g.id} game={g} selected={g.id === gameId} onSelect={() => setGameId(g.id)} />
              ))}
            </div>
          </fieldset>
        )}
        {games.length === 0 && (
          <p className="rounded-2xl border border-dashed border-border-strong px-5 py-6 text-muted">
            No games found. Run the insert at the bottom of schema.sql in Supabase to add them.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="name" className="mb-2 block font-medium">
          Tournament name
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          className={INPUT}
          placeholder="Faculty Cup"
          autoComplete="off"
        />
      </div>

      <fieldset>
        <legend className="mb-3 font-medium">Format</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {FORMATS.map((f) => (
            <label
              key={f.id}
              className={`rounded-2xl border p-4 ${FOCUS_RING} ${
                f.ready ? "cursor-pointer" : "cursor-not-allowed opacity-60"
              } ${f.id === format ? "border-primary bg-primary/5" : "border-border bg-surface"}`}
            >
              <input
                type="radio"
                name="format"
                className="sr-only"
                disabled={!f.ready}
                checked={f.id === format}
                onChange={() => setFormat(f.id)}
              />
              <span className="block font-display text-xl font-bold">{f.label}</span>
              <span className="mt-1 block text-sm text-muted">{f.hint}</span>
              {!f.ready && (
                <span className="mt-2 inline-block rounded-full border border-border-strong px-2.5 py-0.5 text-xs text-subtle">
                  Coming soon
                </span>
              )}
            </label>
          ))}
        </div>
        {format === "groups_knockout" && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="groups" className="mb-2 block font-medium">
                Groups
              </label>
              <select id="groups" value={groupCount} onChange={(e) => setGroupCount(Number(e.target.value))} className={INPUT}>
                {Array.from({ length: MAX_GROUPS - 1 }, (_, i) => i + 2).map((n) => (
                  <option key={n} value={n}>
                    {n} groups
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="advance" className="mb-2 block font-medium">
                Go through from each group
              </label>
              <select id="advance" value={advance} onChange={(e) => setAdvance(Number(e.target.value))} className={INPUT}>
                {Array.from({ length: MAX_ADVANCE }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    Top {n}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-sm text-muted sm:col-span-2">
              Teams are split into groups in the order you list them (the best seeds are spread across groups). The knockout is
              drawn after the last group match.
            </p>
          </div>
        )}
        {format !== "knockout" && (
          <label className="mt-4 flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={doubleRound}
              onChange={(e) => setDoubleRound(e.target.checked)}
              className="size-5 accent-primary"
            />
            <span>
              Home and away
              <span className="block text-sm text-muted">
                Every pairing plays twice, once at each side{format === "groups_knockout" ? " (in the group stage)" : ""}.
              </span>
            </span>
          </label>
        )}
      </fieldset>
    </div>,

    // 2. Teams
    <div key="teams" className="space-y-4">
      <div>
        <label htmlFor="teams" className="mb-2 block font-medium">
          {entrant === "player" ? "Players" : "Teams"}, one per line
        </label>
        <textarea
          id="teams"
          value={teamsText}
          onChange={(e) => {
            setTeamsText(e.target.value);
            setShuffleKey(0);
          }}
          rows={10}
          className={`${INPUT} resize-y font-medium`}
          placeholder={"Computer Eng\nMechanical\nLaw Lions"}
          spellCheck={false}
        />
        <p className="mt-2 text-sm text-subtle">
          You can paste a whole list from a chat or spreadsheet.
          {format !== "round_robin" && ` The first name is the top seed. Shuffle at the end for a random draw.`}
        </p>
      </div>

      <p aria-live="polite" className="font-display text-2xl font-bold">
        {ordered.length} {entrant}
        {ordered.length === 1 ? "" : "s"}
        <span className="ml-3 font-sans text-sm font-normal text-subtle">
          {ordered.length < 2
            ? `Add at least 2 to start.`
            : ordered.length > MAX_ENTRANTS
              ? `The most you can add is ${MAX_ENTRANTS}.`
              : format === "groups_knockout"
                ? planProblem ?? `${ordered.length} split into ${groupCount} groups.`
                : format === "knockout"
                ? ordered.length & (ordered.length - 1)
                  ? `Not a round number, so the top seeds skip round 1.`
                  : ""
                : ordered.length % 2 === 1
                  ? `With an odd number, one ${entrant} rests each round.`
                  : ""}
        </span>
      </p>

      {parsed.repeated.length > 0 && (
        <p className="text-sm text-draw">Listed more than once, counted once: {parsed.repeated.join(", ")}</p>
      )}
      {parsed.tooLong.length > 0 && (
        <p role="alert" className="text-sm text-loss">
          Names can be at most {MAX_NAME} characters. Shorten: {parsed.tooLong.join(", ")}
        </p>
      )}
    </div>,

    // 3. Details
    <div key="details" className="space-y-8">
      <fieldset>
        <legend className="mb-3 font-medium">Who can see it?</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {VISIBILITY.map((v) => (
            <label
              key={v.id}
              className={`rounded-2xl border p-4 ${FOCUS_RING} ${
                v.ready ? "cursor-pointer" : "cursor-not-allowed opacity-60"
              } ${v.id === visibility ? "border-primary bg-primary/5" : "border-border bg-surface"}`}
            >
              <input
                type="radio"
                name="visibility"
                className="sr-only"
                disabled={!v.ready}
                checked={v.id === visibility}
                onChange={() => setVisibility(v.id)}
              />
              <span className="block font-display text-xl font-bold">{v.label}</span>
              <span className="mt-1 block text-sm text-muted">{v.hint}</span>
              {!v.ready && (
                <span className="mt-2 inline-block rounded-full border border-border-strong px-2.5 py-0.5 text-xs text-subtle">
                  Coming soon
                </span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="org" className="mb-2 block font-medium">
          Department or faculty <span className="font-normal text-subtle">(optional)</span>
        </label>
        <select id="org" value={orgChoice} onChange={(e) => setOrgChoice(e.target.value)} className={INPUT}>
          <option value="">Not part of one</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          <option value={NEW_ORG}>Add a new one...</option>
        </select>

        {orgChoice === NEW_ORG && (
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label htmlFor="orgname" className="mb-2 block text-sm text-muted">
                Name
              </label>
              <input
                id="orgname"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                maxLength={60}
                className={INPUT}
                placeholder="Computer Engineering"
              />
            </div>
            <div>
              <label htmlFor="orgtype" className="mb-2 block text-sm text-muted">
                Type
              </label>
              <select id="orgtype" value={newOrgType} onChange={(e) => setNewOrgType(e.target.value)} className={INPUT}>
                <option value="department">Department</option>
                <option value="faculty">Faculty</option>
                <option value="group">Friend group</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="starts" className="mb-2 block font-medium">
          Start date <span className="font-normal text-subtle">(optional)</span>
        </label>
        <input
          id="starts"
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          className={`${INPUT} sm:max-w-xs`}
        />
      </div>
    </div>,

    // 4. Review
    <div key="review" className="space-y-6">
      <dl className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {[
          ["Game", game?.name ?? ""],
          ["Name", name.trim()],
          [
            "Format",
            `${formatLabel}${format !== "knockout" && doubleRound ? ", home and away" : ""}${
              format === "groups_knockout" ? `, ${groupCount} groups, top ${advance} through` : ""
            }`,
          ],
          [entrant === "player" ? "Players" : "Teams", String(ordered.length)],
          ["Visibility", VISIBILITY.find((v) => v.id === visibility)?.label ?? ""],
          ["Department or faculty", orgName],
          ["Starts", startsAt ? new Date(startsAt).toLocaleString() : "Not set"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-6 px-4 py-3">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      {schedule && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-2xl font-bold">
              {schedule.total} {format === "groups_knockout" ? "group " : ""}
              {schedule.total === 1 ? "match" : "matches"} in {schedule.rounds.length}{" "}
              {schedule.rounds.length === 1 ? (format === "groups_knockout" ? "matchday" : "round") : format === "groups_knockout" ? "matchdays" : "rounds"}
            </h3>
            <button
              type="button"
              onClick={() => setShuffleKey(1 + Math.floor(Math.random() * 1_000_000_000))}
              className="cursor-pointer rounded-full border border-border-strong px-4 py-2 text-sm font-medium transition hover:border-foreground"
            >
              Shuffle the draw
            </button>
          </div>

          {schedule.groups && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              {schedule.groups.map((g) => (
                <div key={g.label} className="rounded-2xl border border-border bg-surface px-4 py-3">
                  <h4 className="font-display text-xl font-semibold">Group {g.label}</h4>
                  <p className="text-muted">{g.names.join(", ")}</p>
                </div>
              ))}
            </div>
          )}
          {schedule.note && <p className="mb-3 text-sm text-muted">{schedule.note}</p>}
          {schedule.byes.length > 0 && (
            <p className="mb-3 text-sm text-muted">Skipping round 1: {schedule.byes.join(", ")}.</p>
          )}
          {schedule.rounds.slice(0, 1).map(([round, matches, title]) => (
            <RoundList key={round} title={title} matches={matches} />
          ))}
          {schedule.rounds.length > 1 && (
            <details className="mt-3 rounded-2xl border border-border bg-surface px-4 py-3">
              <summary className="cursor-pointer font-medium">
                Show the other {schedule.rounds.length - 1} {schedule.rounds.length === 2 ? "round" : "rounds"}
              </summary>
              <div className="mt-3 space-y-4">
                {schedule.rounds.slice(1).map(([round, matches, title]) => (
                  <RoundList key={round} title={title} matches={matches} />
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-loss/40 bg-loss/10 px-4 py-3 text-sm text-loss">
          {error}
        </p>
      )}
    </div>,
  ];

  const titles = [
    ["Pick the game", "This decides how scores and points work."],
    [`Who's playing?`, `Add every ${entrant}. The order is used for the draw, and you can shuffle it at the end.`],
    ["A few details", "You can leave the optional ones empty."],
    ["Check and create", "Everything below is saved when you create the tournament."],
  ];

  return (
    <MotionConfig reducedMotion="user">
      {shell(
        <form onSubmit={onSubmit} className="mt-8" noValidate>
          <ol className="mb-8 flex items-center gap-2" aria-label="Progress">
            {STEPS.map((label, i) => (
              <li
                key={label}
                aria-current={i === step ? "step" : undefined}
                className="flex flex-1 items-center gap-2 last:flex-none"
              >
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full font-display text-lg font-bold transition-colors ${
                    i < step
                      ? "bg-primary text-primary-foreground"
                      : i === step
                        ? "border-2 border-primary text-primary"
                        : "border border-border-strong text-subtle"
                  }`}
                >
                  {i < step ? (
                    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                      <path d="M3 8.5l3.2 3L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className={`hidden text-sm sm:block ${i === step ? "text-foreground" : "text-subtle"}`}>{label}</span>
                {i < STEPS.length - 1 && (
                  <span className="relative h-px flex-1 bg-border" aria-hidden>
                    <motion.span
                      className="absolute inset-y-0 left-0 bg-primary"
                      initial={false}
                      animate={{ width: i < step ? "100%" : "0%" }}
                      transition={{ duration: 0.35 }}
                    />
                  </span>
                )}
              </li>
            ))}
          </ol>

          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              initial={{ opacity: 0, x: direction * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -24 }}
              transition={{ duration: 0.18 }}
            >
              <h2 ref={headingRef} tabIndex={-1} className="font-display text-4xl font-bold outline-none">
                {titles[step][0]}
              </h2>
              <p className="mb-6 mt-1 text-muted">{titles[step][1]}</p>
              {stepBody[step]}
            </motion.div>
          </AnimatePresence>

          <div className="mt-10 flex items-center justify-between gap-3 border-t border-border pt-6">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => go(step - 1)}
                disabled={busy}
                className="cursor-pointer rounded-full border border-border-strong px-6 py-3 font-semibold transition hover:border-foreground disabled:opacity-50"
              >
                Back
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={!valid[step] || busy}
              className="cursor-pointer rounded-full bg-primary px-8 py-3 font-semibold text-primary-foreground transition hover:shadow-glow-lime disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {step < STEPS.length - 1 ? "Next" : busy ? "Creating..." : "Create tournament"}
            </button>
          </div>
        </form>,
      )}
    </MotionConfig>
  );
}

function GameTile({ game, selected, onSelect }: { game: Game; selected: boolean; onSelect: () => void }) {
  return (
    <label
      className={`cursor-pointer rounded-2xl border p-4 transition ${FOCUS_RING} ${
        selected ? "border-primary bg-primary/5 shadow-glow-lime" : "border-border bg-surface hover:border-border-strong"
      }`}
    >
      <input type="radio" name="game" className="sr-only" checked={selected} onChange={onSelect} />
      <span className="block font-display text-2xl font-bold">{game.name}</span>
      <span className="mt-1 block text-sm text-muted">{describeGame(game)}</span>
    </label>
  );
}

function RoundList({ title, matches }: { title: string; matches: { home: string; away: string; tag?: string }[] }) {
  return (
    <div>
      <h4 className="mb-2 font-display text-xl font-semibold">{title}</h4>
      <ul className="grid gap-x-6 gap-y-1 text-muted sm:grid-cols-2">
        {matches.map((m, i) => (
          <li key={i}>
            {m.tag && <span className="mr-2 text-xs uppercase tracking-wide text-subtle">{m.tag}</span>}
            <span className="text-foreground">{m.home}</span> vs <span className="text-foreground">{m.away}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
