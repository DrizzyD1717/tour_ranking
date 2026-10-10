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

export const DEFAULT_TIEBREAKERS: Tiebreaker[] = [
  "diff",
  "scored",
  "headToHead",
  "wins",
];

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
  if (new Set(ids).size !== ids.length)
    throw new Error("Participant ids must be unique");
  if (ids.length < 2)
    throw new Error("A round robin needs at least 2 participants");

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
      fixtures.push({
        round: f.round + roundsPerLeg,
        home: f.away,
        away: f.home,
        leg: 2,
      });
    }
    for (const b of firstByes)
      byes.push({ round: b.round + roundsPerLeg, id: b.id });
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
export function isValidResult(
  m: MatchResult,
  rules: Pick<GameRules, "allowsDraws">,
): boolean {
  if (m.status !== "finished") return false;
  if (m.home === m.away) return false;
  const { homeScore: h, awayScore: a } = m;
  if (h === null || a === null) return false;
  if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0)
    return false;
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
      {
        id,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        for: 0,
        against: 0,
        diff: 0,
        points: 0,
        form: [],
      },
    ]),
  );

  const valid: ValidMatch[] = [];
  for (const m of matches) {
    if (!rows.has(m.home) || !rows.has(m.away) || !isValidResult(m, rules))
      continue;
    const vm = m as ValidMatch;
    valid.push(vm);
    const home = rows.get(m.home) as Row;
    const away = rows.get(m.away) as Row;
    apply(home, vm.homeScore, vm.awayScore, rules);
    apply(away, vm.awayScore, vm.homeScore, rules);
  }

  const ordered = rankRows([...rows.values()], valid, rules);
  return ordered.map((row, i) => ({
    ...row,
    form: row.form.slice(-5),
    rank: i + 1,
  }));
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
    while (j < byPoints.length && byPoints[j].points === byPoints[i].points)
      j++;
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
function resolveTies(
  group: Row[],
  criteria: Tiebreaker[],
  valid: ValidMatch[],
): Row[] {
  if (group.length <= 1 || criteria.length === 0) return group;

  const [current, ...rest] = criteria;
  const values = tiebreakerValues(current, group, valid);
  const sorted = [...group].sort((a, b) =>
    compareDesc(values.get(a.id) as number[], values.get(b.id) as number[]),
  );

  const parts: Row[][] = [];
  for (const row of sorted) {
    const last = parts[parts.length - 1];
    if (
      last &&
      compareDesc(
        values.get(last[0].id) as number[],
        values.get(row.id) as number[],
      ) === 0
    ) {
      last.push(row);
    } else {
      parts.push([row]);
    }
  }

  return parts.flatMap((part) =>
    part.length === group.length
      ? resolveTies(part, rest, valid)
      : resolveTies(part, criteria, valid),
  );
}

function tiebreakerValues(
  kind: Tiebreaker,
  group: Row[],
  valid: ValidMatch[],
): Map<Id, number[]> {
  const out = new Map<Id, number[]>();
  if (kind !== "headToHead") {
    for (const r of group) {
      out.set(r.id, [
        kind === "diff" ? r.diff : kind === "scored" ? r.for : r.won,
      ]);
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
