/**
 * Pure tournament logic: no React, no database, no side effects.
 * Everything here is deterministic, so it is easy to test and safe to run on
 * the server or the client.
 */

export type Id = string;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Tiebreaker = "headToHead" | "diff" | "scored" | "wins";

/** Mirrors the columns on the `games` table. */
export interface GameRules {
  allowsDraws: boolean;
  ptsWin: number;
  ptsDraw: number;
  ptsLoss: number;
  /** Applied in order after points. Defaults to goal difference, then scored, then head-to-head. */
  tiebreakers?: Tiebreaker[];
}

export const DEFAULT_TIEBREAKERS: Tiebreaker[] = ["diff", "scored", "headToHead", "wins"];

export interface Fixture {
  round: number;
  home: Id;
  away: Id;
  /** 1 = first leg, 2 = return leg (only when doubleRound is true) */
  leg: 1 | 2;
}

export interface Bye {
  round: number;
  id: Id;
}

export interface RoundRobinSchedule {
  fixtures: Fixture[];
  byes: Bye[];
  rounds: number;
}

/** The subset of a `matches` row that standings need. */
export interface MatchResult {
  home: Id;
  away: Id;
  homeScore: number | null;
  awayScore: number | null;
  status: "scheduled" | "live" | "finished";
}

export interface StandingRow {
  id: Id;
  rank: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  for: number;
  against: number;
  diff: number;
  points: number;
  /** Last 5 results, oldest first, in the order matches were passed in. */
  form: ("W" | "D" | "L")[];
}

// ---------------------------------------------------------------------------
// Round-robin fixture generation (circle method)
// ---------------------------------------------------------------------------

/**
 * Generates a full round-robin schedule. With an odd number of participants one
 * team sits out each round (reported in `byes`). Home/away is alternated so no
 * team is stuck at home or away for long stretches.
 */
export function generateRoundRobin(
  ids: Id[],
  opts: { doubleRound?: boolean } = {},
): RoundRobinSchedule {
  if (new Set(ids).size !== ids.length) throw new Error("Participant ids must be unique");
  if (ids.length < 2) throw new Error("A round robin needs at least 2 participants");

  const slots: (Id | null)[] = [...ids];
  if (slots.length % 2 === 1) slots.push(null); // null = bye placeholder
  const n = slots.length;
  const roundsPerLeg = n - 1;

  const fixtures: Fixture[] = [];
  const byes: Bye[] = [];
  const rotation = slots.slice(1);

  for (let r = 0; r < roundsPerLeg; r++) {
    const lineup = [slots[0], ...rotation];
    for (let i = 0; i < n / 2; i++) {
      const a = lineup[i];
      const b = lineup[n - 1 - i];
      if (a === null || b === null) {
        byes.push({ round: r + 1, id: (a ?? b) as Id });
        continue;
      }
      // A rotating team's pair index moves by exactly 1 each round, so the parity of
      // `i` alone alternates its home/away status. (Using r + i would cancel out.)
      // The fixed slot-0 team has no moving index, so it alternates by round instead.
      const flip = i === 0 ? r % 2 === 1 : i % 2 === 1;
      fixtures.push({
        round: r + 1,
        home: flip ? b : a,
        away: flip ? a : b,
        leg: 1,
      });
    }
    rotation.unshift(rotation.pop() as Id | null); // rotate right, slot 0 stays fixed
  }

  if (opts.doubleRound) {
    const firstLeg = [...fixtures];
    const firstByes = [...byes];
    for (const f of firstLeg) {
      fixtures.push({ round: f.round + roundsPerLeg, home: f.away, away: f.home, leg: 2 });
    }
    for (const b of firstByes) byes.push({ round: b.round + roundsPerLeg, id: b.id });
  }

  return {
    fixtures,
    byes,
    rounds: roundsPerLeg * (opts.doubleRound ? 2 : 1),
  };
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

type Row = Omit<StandingRow, "rank">;

interface ValidMatch {
  home: Id;
  away: Id;
  homeScore: number;
  awayScore: number;
}

/** A result counts only if it is finished, fully scored, and legal for this game. */
export function isValidResult(m: MatchResult, rules: Pick<GameRules, "allowsDraws">): boolean {
  if (m.status !== "finished") return false;
  if (m.home === m.away) return false;
  const { homeScore: h, awayScore: a } = m;
  if (h === null || a === null) return false;
  if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) return false;
  if (h === a && !rules.allowsDraws) return false;
  return true;
}

export function computeStandings(
  ids: Id[],
  matches: MatchResult[],
  rules: GameRules,
): StandingRow[] {
  const rows = new Map<Id, Row>(
    ids.map((id) => [
      id,
      { id, played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0, diff: 0, points: 0, form: [] },
    ]),
  );

  const valid: ValidMatch[] = [];
  for (const m of matches) {
    if (!rows.has(m.home) || !rows.has(m.away) || !isValidResult(m, rules)) continue;
    const vm = m as ValidMatch;
    valid.push(vm);
    const home = rows.get(m.home) as Row;
    const away = rows.get(m.away) as Row;
    apply(home, vm.homeScore, vm.awayScore, rules);
    apply(away, vm.awayScore, vm.homeScore, rules);
  }

  const ordered = rankRows([...rows.values()], valid, rules);
  return ordered.map((row, i) => ({ ...row, form: row.form.slice(-5), rank: i + 1 }));
}

function apply(row: Row, scored: number, conceded: number, rules: GameRules) {
  row.played++;
  row.for += scored;
  row.against += conceded;
  row.diff = row.for - row.against;
  if (scored > conceded) {
    row.won++;
    row.points += rules.ptsWin;
    row.form.push("W");
  } else if (scored < conceded) {
    row.lost++;
    row.points += rules.ptsLoss;
    row.form.push("L");
  } else {
    row.drawn++;
    row.points += rules.ptsDraw;
    row.form.push("D");
  }
}

/** Sort by points, then resolve each tied group with the configured tiebreakers. */
function rankRows(rows: Row[], valid: ValidMatch[], rules: GameRules): Row[] {
  const criteria = rules.tiebreakers ?? DEFAULT_TIEBREAKERS;
  const byPoints = [...rows].sort((a, b) => b.points - a.points); // stable: ties keep input order
  const result: Row[] = [];
  let i = 0;
  while (i < byPoints.length) {
    let j = i + 1;
    while (j < byPoints.length && byPoints[j].points === byPoints[i].points) j++;
    result.push(...resolveTies(byPoints.slice(i, j), criteria, valid));
    i = j;
  }
  return result;
}

/**
 * Splits a tied group by the first criterion. If that fully separates nobody,
 * move to the next criterion. If it separates some teams, each smaller subgroup
 * is re-evaluated from the start (head-to-head is recalculated among only the
 * teams still tied, as in UEFA rules).
 */
function resolveTies(group: Row[], criteria: Tiebreaker[], valid: ValidMatch[]): Row[] {
  if (group.length <= 1 || criteria.length === 0) return group;

  const [current, ...rest] = criteria;
  const values = tiebreakerValues(current, group, valid);
  const sorted = [...group].sort((a, b) => compareDesc(values.get(a.id) as number[], values.get(b.id) as number[]));

  const parts: Row[][] = [];
  for (const row of sorted) {
    const last = parts[parts.length - 1];
    if (last && compareDesc(values.get(last[0].id) as number[], values.get(row.id) as number[]) === 0) {
      last.push(row);
    } else {
      parts.push([row]);
    }
  }

  return parts.flatMap((part) =>
    part.length === group.length ? resolveTies(part, rest, valid) : resolveTies(part, criteria, valid),
  );
}

function tiebreakerValues(kind: Tiebreaker, group: Row[], valid: ValidMatch[]): Map<Id, number[]> {
  const out = new Map<Id, number[]>();
  if (kind !== "headToHead") {
    for (const r of group) {
      out.set(r.id, [kind === "diff" ? r.diff : kind === "scored" ? r.for : r.won]);
    }
    return out;
  }

  // Head-to-head: a mini league using only matches between the tied teams.
  const inGroup = new Set(group.map((r) => r.id));
  const mini = new Map<Id, { pts: number; diff: number; scored: number }>(
    group.map((r) => [r.id, { pts: 0, diff: 0, scored: 0 }]),
  );
  // Points here use 3/1/0; only the relative order inside the group matters.
  for (const m of valid) {
    if (!inGroup.has(m.home) || !inGroup.has(m.away)) continue;
    const h = mini.get(m.home) as { pts: number; diff: number; scored: number };
    const a = mini.get(m.away) as { pts: number; diff: number; scored: number };
    h.scored += m.homeScore;
    a.scored += m.awayScore;
    h.diff += m.homeScore - m.awayScore;
    a.diff += m.awayScore - m.homeScore;
    if (m.homeScore > m.awayScore) h.pts += 3;
    else if (m.homeScore < m.awayScore) a.pts += 3;
    else {
      h.pts += 1;
      a.pts += 1;
    }
  }
  for (const [id, v] of mini) out.set(id, [v.pts, v.diff, v.scored]);
  return out;
}

/** Descending lexicographic comparison of number tuples. */
function compareDesc(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Knockout brackets
// ---------------------------------------------------------------------------

/** One match of a freshly drawn bracket, before it has been saved anywhere. */
export interface BracketMatch {
  /** Stable name inside this draw, `${round}-${pos}`. Used to link matches before they have database ids. */
  key: string;
  round: number;
  /** Position in the round, top to bottom, counting byes (so round 1 can have gaps). */
  pos: number;
  home: Id | null;
  away: Id | null;
  /** Where the winner goes. null for the final. */
  next: { key: string; slot: "home" | "away" } | null;
}

export interface KnockoutSchedule {
  matches: BracketMatch[];
  rounds: number;
  /** Bracket size: the next power of two at or above the number of entrants. */
  size: number;
  /** Entrants who skip round 1 (top seeds first). */
  byes: Id[];
}

/** Seed numbers in bracket order, so 1 meets the lowest seed and the top seeds can only meet late. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const total = order.length * 2;
    order = order.flatMap((seed) => [seed, total + 1 - seed]);
  }
  return order;
}

/**
 * Draws a single-elimination bracket. `ids` are in seed order (best first).
 * When the field is not a power of two, the top seeds get byes: they are placed straight
 * into round 2 and no round-1 match is created for them.
 */
export function generateKnockout(ids: Id[]): KnockoutSchedule {
  if (ids.length < 2) throw new Error("A knockout needs at least 2 entrants.");
  if (new Set(ids).size !== ids.length) throw new Error("Entrants must be unique.");

  let size = 2;
  while (size < ids.length) size *= 2;
  const rounds = Math.log2(size);
  const order = seedOrder(size);
  const byes: Id[] = [];
  const matches: BracketMatch[] = [];
  const key = (round: number, pos: number) => `${round}-${pos}`;

  // `feed[pos]` says who arrives at each slot of the next round: a known entrant (bye) or a match to be won.
  let feed: ({ id: Id } | { match: string })[] = [];
  for (let pos = 0; pos < size / 2; pos++) {
    const a = ids[order[pos * 2] - 1] ?? null;
    const b = ids[order[pos * 2 + 1] - 1] ?? null;
    if (a && b) {
      matches.push({ key: key(1, pos), round: 1, pos, home: a, away: b, next: null });
      feed.push({ match: key(1, pos) });
    } else {
      const sitting = (a ?? b) as Id;
      byes.push(sitting);
      feed.push({ id: sitting });
    }
  }

  for (let round = 2; round <= rounds; round++) {
    const nextFeed: typeof feed = [];
    for (let pos = 0; pos < feed.length / 2; pos++) {
      const k = key(round, pos);
      const home = feed[pos * 2];
      const away = feed[pos * 2 + 1];
      matches.push({
        key: k,
        round,
        pos,
        home: "id" in home ? home.id : null,
        away: "id" in away ? away.id : null,
        next: null,
      });
      nextFeed.push({ match: k });
      for (const [source, slot] of [[home, "home"], [away, "away"]] as const) {
        if ("match" in source) matches.find((m) => m.key === source.match)!.next = { key: k, slot };
      }
    }
    feed = nextFeed;
  }

  return { matches, rounds, size, byes };
}

/** "Final", "Semi-finals", "Quarter-finals", "Round of 16", then "Round N". */
export function roundName(round: number, rounds: number): string {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semi-finals";
  if (fromEnd === 2) return "Quarter-finals";
  if (fromEnd === 3) return "Round of 16";
  if (fromEnd === 4) return "Round of 32";
  return `Round ${round}`;
}

/** The subset of a `matches` row that bracket logic needs. */
export interface BracketRow {
  id: Id;
  round: number;
  home_id: Id | null;
  away_id: Id | null;
  home_score: number | null;
  away_score: number | null;
  status: "scheduled" | "live" | "finished";
  next_match_id: Id | null;
  next_slot: "home" | "away" | null;
}

/** Winner of a finished, decisive match, otherwise null. */
export function knockoutWinner(m: Pick<BracketRow, "home_id" | "away_id" | "home_score" | "away_score" | "status">): Id | null {
  if (m.status !== "finished" || !m.home_id || !m.away_id) return null;
  if (m.home_score === null || m.away_score === null || m.home_score === m.away_score) return null;
  return m.home_score > m.away_score ? m.home_id : m.away_id;
}

export interface BracketLayout<T> {
  rounds: number;
  /** One column per round. A slot is null where round 1 has a bye. */
  columns: { round: number; slots: (T | null)[] }[];
  final: T;
}

/**
 * Arranges saved matches into columns by following each match's `next_match_id`.
 * Returns null when the rows do not form a bracket (no final, or broken links).
 */
export function layoutBracket<T extends BracketRow>(rows: T[]): BracketLayout<T> | null {
  const finals = rows.filter((m) => m.next_match_id === null);
  if (finals.length !== 1) return null;
  const final = finals[0];
  const rounds = final.round;

  const feeders = new Map<Id, T[]>();
  for (const m of rows) {
    if (m.next_match_id) feeders.set(m.next_match_id, [...(feeders.get(m.next_match_id) ?? []), m]);
  }

  const columns = Array.from({ length: rounds }, (_, i) => ({
    round: i + 1,
    slots: Array.from({ length: 2 ** (rounds - 1 - i) }, () => null as T | null),
  }));

  let placed = 0;
  const place = (m: T, pos: number): boolean => {
    const column = columns[m.round - 1];
    if (!column || pos >= column.slots.length || column.slots[pos] !== null) return false;
    column.slots[pos] = m;
    placed++;
    for (const f of feeders.get(m.id) ?? []) {
      if (!f.next_slot || f.round !== m.round - 1) return false;
      if (!place(f, pos * 2 + (f.next_slot === "home" ? 0 : 1))) return false;
    }
    return true;
  };

  if (!place(final, 0) || placed !== rows.length) return null;
  return { rounds, columns, final };
}

/**
 * Applies a change to one knockout match and moves the winner into the next round.
 * This mirrors the database trigger, so the screen updates at once and the demo works without a database.
 * Returns the problem instead of changing anything when the change is not allowed.
 */
export function advanceKnockout<T extends BracketRow>(
  rows: T[],
  id: Id,
  patch: Partial<Pick<BracketRow, "status" | "home_score" | "away_score">>,
): { rows: T[]; error: string | null } {
  const current = rows.find((m) => m.id === id);
  if (!current) return { rows, error: "This match is no longer part of the tournament. Reload the page." };
  const updated = { ...current, ...patch };

  if (updated.status === "finished") {
    if (!updated.home_id || !updated.away_id) return { rows, error: "Both sides must be known before a result is saved." };
    if (updated.home_score === null || updated.away_score === null) return { rows, error: "Enter both scores first." };
    if (updated.home_score === updated.away_score) {
      return { rows, error: "A knockout match cannot end level. Count extra time or penalties so one side is ahead." };
    }
  }

  const before = knockoutWinner(current);
  const after = knockoutWinner(updated);
  let next = rows.map((m) => (m.id === id ? updated : m));

  if (before !== after && current.next_match_id && current.next_slot) {
    const target = rows.find((m) => m.id === current.next_match_id);
    if (target && target.status !== "scheduled") {
      return { rows, error: "The next round has already started. Fix that result first." };
    }
    const field = current.next_slot === "home" ? "home_id" : "away_id";
    next = next.map((m) => (m.id === current.next_match_id ? { ...m, [field]: after } : m));
  }
  return { rows: next, error: null };
}

// ---------------------------------------------------------------------------
// Groups, then knockout
// ---------------------------------------------------------------------------

export const MAX_GROUPS = 8;
export const MAX_ADVANCE = 4;

export const groupLabel = (index: number) => String.fromCharCode(65 + index);

/**
 * Why a groups plan cannot work, or null when it can. A group needs at least one more
 * entrant than it sends through, otherwise the group stage decides nothing.
 */
export function groupPlanProblem(entrants: number, groups: number, advance: number): string | null {
  if (groups < 2 || groups > MAX_GROUPS) return `Use between 2 and ${MAX_GROUPS} groups.`;
  if (advance < 1 || advance > MAX_ADVANCE) return `Between 1 and ${MAX_ADVANCE} can go through from each group.`;
  if (groups * advance < 2) return "At least 2 must go through to the knockout.";
  const smallest = Math.floor(entrants / groups);
  if (smallest < advance + 1) {
    return `${entrants} entrants in ${groups} groups leaves ${smallest} in the smallest group, which is too few when ${advance} go through. Add more or use fewer groups.`;
  }
  return null;
}

/**
 * Splits entrants (best seed first) into groups by "snaking" down the seed list:
 * A B C D, then D C B A, and so on, so every group gets a similar mix of strong and weak.
 */
export function assignGroups(ids: Id[], groups: number): { label: string; ids: Id[] }[] {
  const out = Array.from({ length: groups }, (_, i) => ({ label: groupLabel(i), ids: [] as Id[] }));
  ids.forEach((id, i) => {
    const row = Math.floor(i / groups);
    const col = i % groups;
    out[row % 2 === 0 ? col : groups - 1 - col].ids.push(id);
  });
  return out;
}

export interface GroupFixture extends Fixture {
  group: string;
}

/** A round robin inside each group. Round numbers line up across groups, so round 1 is every group's first matchday. */
export function generateGroupStage(
  groups: { label: string; ids: Id[] }[],
  options: { doubleRound?: boolean } = {},
): { fixtures: GroupFixture[]; rounds: number } {
  const fixtures: GroupFixture[] = [];
  let rounds = 0;
  for (const g of groups) {
    const rr = generateRoundRobin(g.ids, options);
    rounds = Math.max(rounds, rr.rounds);
    for (const f of rr.fixtures) fixtures.push({ ...f, group: g.label });
  }
  fixtures.sort((a, b) => a.round - b.round || a.group.localeCompare(b.group));
  return { fixtures, rounds };
}

/**
 * Orders the qualifiers for the bracket. Everyone who finished 1st in their group is seeded before
 * anyone who finished 2nd, and so on; inside one finishing place, better records (points, goal
 * difference, goals scored) get the better seed. Then, where the bracket would make two members of
 * the same group meet in round 1, qualifiers of the same finishing place are swapped to avoid it
 * (for example A1 v B2 and B1 v A2 rather than A1 v A2). If a clash cannot be avoided it is left.
 */
export function seedQualifiers(tables: { label: string; rows: StandingRow[] }[], advance: number): Id[] {
  type Entry = { id: Id; group: string; tier: number };
  const list: Entry[] = [];
  for (let place = 0; place < advance; place++) {
    const tier = tables
      .map((t) => ({ label: t.label, row: t.rows[place] }))
      .filter((x): x is { label: string; row: StandingRow } => x.row !== undefined)
      .sort(
        (a, b) =>
          b.row.points - a.row.points ||
          b.row.diff - a.row.diff ||
          b.row.for - a.row.for ||
          a.label.localeCompare(b.label),
      );
    list.push(...tier.map((x) => ({ id: x.row.id, group: x.label, tier: place })));
  }

  const n = list.length;
  if (n >= 3) {
    let size = 2;
    while (size < n) size *= 2;
    const order = seedOrder(size);
    const pairs: [number, number][] = [];
    for (let i = 0; i < size / 2; i++) {
      const a = order[i * 2] - 1;
      const b = order[i * 2 + 1] - 1;
      if (a < n && b < n) pairs.push([a, b]); // a bye is not a match
    }
    const clashes = (arr: Entry[]) => pairs.filter(([a, b]) => arr[a].group === arr[b].group).length;

    let current = clashes(list);
    for (let pass = 0; pass < n && current > 0; pass++) {
      let moved = false;
      for (const [a, b] of pairs) {
        if (list[a].group !== list[b].group) continue;
        let best: { from: number; to: number; clashes: number } | null = null;
        for (const from of [b, a]) {
          for (let to = 0; to < n; to++) {
            if (to === from || list[to].tier !== list[from].tier) continue;
            const trial = [...list];
            [trial[from], trial[to]] = [trial[to], trial[from]];
            const c = clashes(trial);
            const closer = best !== null && c === best.clashes && Math.abs(to - from) < Math.abs(best.to - best.from);
            if (c < current && (best === null || c < best.clashes || closer)) best = { from, to, clashes: c };
          }
        }
        if (best) {
          [list[best.from], list[best.to]] = [list[best.to], list[best.from]];
          current = best.clashes;
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
  }
  return list.map((e) => e.id);
}

// ---------------------------------------------------------------------------
// All-time rankings (across tournaments)
// ---------------------------------------------------------------------------

/** Everything the rankings need about one tournament. */
export interface RankingTournament {
  id: Id;
  slug: string;
  name: string;
  status: "draft" | "live" | "finished";
  format: "round_robin" | "knockout" | "groups_knockout";
  game: { slug: string; name: string; category: string } & Pick<GameRules, "allowsDraws" | "ptsWin" | "ptsDraw" | "ptsLoss">;
  /** `user_id` is set when the entrant is a real account; those are matched by account, not by name. */
  participants: { id: Id; name: string; user_id?: Id | null; /** The account's current username, when linked. */ username?: string | null; /** Only "accepted" links count. Leave it out to treat a link as accepted. */ link_status?: string | null }[];
  matches: (BracketRow & { group_label: string | null })[];
}

/** An entrant typed as `@username` is linked to that account. Returns the username, or null for a plain name. */
export const ACCOUNT_LINK = /^@([a-z0-9_]{3,20})$/i;
export function accountUsername(entry: string): string | null {
  const m = ACCOUNT_LINK.exec(entry.trim());
  return m ? m[1].toLowerCase() : null;
}

export interface RankingRow {
  /** Linked accounts are keyed by account id; everyone else by their name with case and spacing ignored. */
  key: string;
  /** The spelling used most often. Linked accounts show as @username (their current one). */
  name: string;
  /** Set for linked accounts: the current username, which the public player page is found by. */
  username?: string;
  tournaments: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  for: number;
  against: number;
  diff: number;
  titles: number;
  /** Wins as a share of matches played, 0 to 1. */
  winRate: number;
}

export interface GameRanking {
  slug: string;
  name: string;
  category: string;
  tournaments: number;
  rows: RankingRow[];
}

export interface Champion {
  tournamentId: Id;
  slug: string;
  tournament: string;
  game: string;
  name: string;
  /** Same key as the ranking row, so a champion can be matched to an account (`u:<id>`) or a plain name. */
  key: string;
}

export type RankingSort = "titles" | "wins" | "winRate";

export const rankingKey = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase();

/** Who won a finished tournament, or null if it is unfinished or has no clear winner. */
export function championOf(t: RankingTournament): Id | null {
  if (t.status !== "finished") return null;
  if (t.format === "round_robin") {
    const results: MatchResult[] = t.matches
      .filter((m) => m.home_id && m.away_id)
      .map((m) => ({ home: m.home_id as Id, away: m.away_id as Id, homeScore: m.home_score, awayScore: m.away_score, status: m.status }));
    const top = computeStandings(t.participants.map((p) => p.id), results, t.game)[0];
    return top && top.played > 0 ? top.id : null;
  }
  const bracketRows = t.format === "knockout" ? t.matches : t.matches.filter((m) => m.group_label === null);
  const layout = bracketRows.length > 0 ? layoutBracket(bracketRows) : null;
  return layout ? knockoutWinner(layout.final) : null;
}

/**
 * Combines public tournaments into all-time tables, one per game. Entrants linked to an account are
 * matched by that account, so a renamed user stays one row and a plain name can never be mistaken for
 * them. Everyone else is matched by name (ignoring case and extra spaces), so two unrelated "Dari"s
 * playing the same game will be counted as one. Only finished, fully scored,
 * legal results count. `champions` follows the order the tournaments were passed in.
 */
export function buildRankings(tournaments: RankingTournament[]): { games: GameRanking[]; champions: Champion[] } {
  type Acc = RankingRow & { spellings: Map<string, number>; seen: Set<Id> };
  const byGame = new Map<string, { info: GameRanking; rows: Map<string, Acc>; tournaments: Set<Id> }>();
  const champions: Champion[] = [];

  for (const t of tournaments) {
    let game = byGame.get(t.game.slug);
    if (!game) {
      game = { info: { slug: t.game.slug, name: t.game.name, category: t.game.category, tournaments: 0, rows: [] }, rows: new Map(), tournaments: new Set() };
      byGame.set(t.game.slug, game);
    }
    const g = game;

    const entrant = new Map<Id, Acc>();
    for (const p of t.participants) {
      // A link the person hasn't accepted (or has declined) is just a name.
      const linked = Boolean(p.user_id) && (!p.link_status || p.link_status === "accepted");
      const key = linked ? `u:${p.user_id}` : rankingKey(p.name);
      if (!rankingKey(p.name)) continue;
      const shown = linked && p.username ? `@${p.username}` : p.name.replace(/\s+/g, " ").trim();
      let row = g.rows.get(key);
      if (!row) {
        row = { key, name: shown, tournaments: 0, played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0, diff: 0, titles: 0, winRate: 0, spellings: new Map(), seen: new Set() };
        g.rows.set(key, row);
      }
      if (linked && p.username) row.username = p.username;
      row.spellings.set(shown, (row.spellings.get(shown) ?? 0) + 1);
      entrant.set(p.id, row);
    }

    let counted = false;
    for (const m of t.matches) {
      if (!m.home_id || !m.away_id) continue;
      const result: MatchResult = { home: m.home_id, away: m.away_id, homeScore: m.home_score, awayScore: m.away_score, status: m.status };
      if (!isValidResult(result, t.game)) continue;
      const home = entrant.get(m.home_id);
      const away = entrant.get(m.away_id);
      if (!home || !away || home === away) continue;
      const h = m.home_score as number;
      const a = m.away_score as number;
      for (const [row, scored, conceded] of [[home, h, a], [away, a, h]] as const) {
        row.played++;
        row.for += scored;
        row.against += conceded;
        if (scored > conceded) row.won++;
        else if (scored < conceded) row.lost++;
        else row.drawn++;
        row.seen.add(t.id);
      }
      counted = true;
    }

    const winner = championOf(t);
    if (winner) {
      const row = entrant.get(winner);
      if (row) {
        row.titles++;
        row.seen.add(t.id);
        champions.push({ tournamentId: t.id, slug: t.slug, tournament: t.name, game: t.game.name, name: row.username ? `@${row.username}` : row.name, key: row.key });
        counted = true;
      }
    }
    if (counted) g.tournaments.add(t.id);
  }

  const games: GameRanking[] = [];
  for (const { info, rows, tournaments: ts } of byGame.values()) {
    const list: RankingRow[] = [];
    for (const r of rows.values()) {
      if (r.played === 0 && r.titles === 0) continue;
      let best = r.name;
      let most = 0;
      for (const [spelling, n] of r.spellings) if (n > most) ((best = spelling), (most = n));
      list.push({
        key: r.key, name: r.username ? `@${r.username}` : best, ...(r.username ? { username: r.username } : {}), tournaments: r.seen.size, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost,
        for: r.for, against: r.against, diff: r.for - r.against, titles: r.titles, winRate: r.played ? r.won / r.played : 0,
      });
    }
    if (list.length === 0) continue;
    games.push({ ...info, tournaments: ts.size, rows: sortRankings(list, "titles") });
  }
  games.sort((a, b) => b.tournaments - a.tournaments || a.name.localeCompare(b.name));
  return { games, champions };
}

export function sortRankings(rows: RankingRow[], by: RankingSort): RankingRow[] {
  const order: Record<RankingSort, (a: RankingRow, b: RankingRow) => number> = {
    titles: (a, b) => b.titles - a.titles || b.won - a.won || b.diff - a.diff,
    wins: (a, b) => b.won - a.won || b.titles - a.titles || b.diff - a.diff,
    winRate: (a, b) => b.winRate - a.winRate || b.played - a.played || b.titles - a.titles,
  };
  return [...rows].sort((a, b) => order[by](a, b) || a.name.localeCompare(b.name));
}

export interface PersonalRecord {
  game: { slug: string; name: string };
  /** Position in that game's table (1 = top) out of `of` ranked entrants. */
  rank: number;
  of: number;
  row: RankingRow;
}

/** One account's line in every game table it appears in, best-ranked first. Rankings must come from buildRankings. */
export function recordFor(games: GameRanking[], userId: Id): PersonalRecord[] {
  const key = `u:${userId}`;
  const out: PersonalRecord[] = [];
  for (const g of games) {
    const i = g.rows.findIndex((r) => r.key === key);
    if (i >= 0) out.push({ game: { slug: g.slug, name: g.name }, rank: i + 1, of: g.rows.length, row: g.rows[i] });
  }
  return out.sort((a, b) => a.rank / a.of - b.rank / b.of || b.row.titles - a.row.titles);
}

// ---------------------------------------------------------------------------
// Archiving
// ---------------------------------------------------------------------------

/** 'auto' archives a day after the tournament finishes; 'archived' archives now; 'pinned' never auto-archives. */
export type ArchiveMode = "auto" | "archived" | "pinned";

export const ARCHIVE_AFTER_MS = 24 * 60 * 60 * 1000;

/** The moment an 'auto' tournament becomes archived, or null if it isn't going to be (not finished, or not 'auto'). */
export function archiveDueAt(t: { archive_mode?: ArchiveMode | null; status: string; finished_at?: string | null }): Date | null {
  if ((t.archive_mode ?? "auto") !== "auto" || t.status !== "finished" || !t.finished_at) return null;
  const at = new Date(t.finished_at).getTime();
  return Number.isNaN(at) ? null : new Date(at + ARCHIVE_AFTER_MS);
}

/** Archived tournaments leave the home list but keep their page, rankings and records. */
export function isArchived(
  t: { archive_mode?: ArchiveMode | null; status: string; finished_at?: string | null },
  now: number = Date.now(),
): boolean {
  const mode = t.archive_mode ?? "auto";
  if (mode === "archived") return true;
  if (mode === "pinned") return false;
  const due = archiveDueAt(t);
  return due !== null && now >= due.getTime();
}
