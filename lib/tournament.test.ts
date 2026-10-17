import { describe, expect, it } from "vitest";
import {
  advanceKnockout,
  assignGroups,
  computeStandings,
  generateGroupStage,
  generateKnockout,
  generateRoundRobin,
  groupPlanProblem,
  knockoutWinner,
  layoutBracket,
  roundName,
  seedOrder,
  seedQualifiers,
  type BracketRow,
  type GameRules,
  type MatchResult,
  type StandingRow,
} from "./tournament";

const football: GameRules = { allowsDraws: true, ptsWin: 3, ptsDraw: 1, ptsLoss: 0 };
const basketball: GameRules = { allowsDraws: false, ptsWin: 2, ptsDraw: 0, ptsLoss: 1 };

const teams = (n: number) => Array.from({ length: n }, (_, i) => `T${i + 1}`);

const fin = (home: string, homeScore: number, awayScore: number, away: string): MatchResult => ({
  home,
  away,
  homeScore,
  awayScore,
  status: "finished",
});

describe("generateRoundRobin", () => {
  for (let n = 2; n <= 12; n++) {
    it(`covers every pair exactly once for ${n} participants`, () => {
      const ids = teams(n);
      const { fixtures, byes, rounds } = generateRoundRobin(ids);

      expect(fixtures).toHaveLength((n * (n - 1)) / 2);
      expect(rounds).toBe(n % 2 === 0 ? n - 1 : n);

      const pairs = new Set(fixtures.map((f) => [f.home, f.away].sort().join("|")));
      expect(pairs.size).toBe(fixtures.length);

      // nobody plays twice in a round, and nobody both plays and has a bye
      for (let r = 1; r <= rounds; r++) {
        const seen = [
          ...fixtures.filter((f) => f.round === r).flatMap((f) => [f.home, f.away]),
          ...byes.filter((b) => b.round === r).map((b) => b.id),
        ];
        expect(new Set(seen).size).toBe(seen.length);
      }

      // odd counts: each team has exactly one bye
      if (n % 2 === 1) {
        expect(byes).toHaveLength(n);
        expect(new Set(byes.map((b) => b.id)).size).toBe(n);
      } else {
        expect(byes).toHaveLength(0);
      }
    });

    it(`keeps home/away balanced for ${n} participants`, () => {
      const ids = teams(n);
      const { fixtures } = generateRoundRobin(ids);
      const home = new Map(ids.map((id) => [id, 0]));
      const away = new Map(ids.map((id) => [id, 0]));
      for (const f of fixtures) {
        home.set(f.home, (home.get(f.home) as number) + 1);
        away.set(f.away, (away.get(f.away) as number) + 1);
      }
      for (const id of ids) {
        expect(Math.abs((home.get(id) as number) - (away.get(id) as number))).toBeLessThanOrEqual(2);
      }
    });
  }

  it("double round adds mirrored return legs", () => {
    const { fixtures, rounds } = generateRoundRobin(teams(4), { doubleRound: true });
    expect(fixtures).toHaveLength(12);
    expect(rounds).toBe(6);
    for (const f of fixtures.filter((x) => x.leg === 1)) {
      const back = fixtures.find((x) => x.leg === 2 && x.home === f.away && x.away === f.home);
      expect(back).toBeDefined();
      expect((back as { round: number }).round).toBeGreaterThan(3);
    }
    // each team is home exactly 3 times over a double round robin of 4
    for (const id of teams(4)) {
      expect(fixtures.filter((f) => f.home === id)).toHaveLength(3);
    }
  });

  it("rejects duplicate ids and fewer than 2 participants", () => {
    expect(() => generateRoundRobin(["A", "A"])).toThrow();
    expect(() => generateRoundRobin(["A"])).toThrow();
  });
});

describe("computeStandings", () => {
  it("awards points and ranks by points", () => {
    const rows = computeStandings(["A", "B", "C"], [fin("A", 2, 0, "B"), fin("B", 1, 1, "C"), fin("A", 3, 1, "C")], football);
    // B and C both end on 1 point and -2 goal difference; C scored more (2 vs 1), so C ranks higher.
    expect(rows.map((r) => r.id)).toEqual(["A", "C", "B"]);
    const a = rows[0];
    expect(a).toMatchObject({ played: 2, won: 2, points: 6, for: 5, against: 1, diff: 4, rank: 1 });
    expect(rows[1]).toMatchObject({ id: "C", points: 1, drawn: 1, lost: 1, for: 2, diff: -2 });
    expect(rows[2]).toMatchObject({ id: "B", points: 1, drawn: 1, lost: 1, for: 1, diff: -2 });
  });

  it("ignores unfinished and incomplete matches", () => {
    const rows = computeStandings(
      ["A", "B"],
      [
        { home: "A", away: "B", homeScore: 5, awayScore: 0, status: "live" },
        { home: "A", away: "B", homeScore: null, awayScore: null, status: "scheduled" },
        { home: "A", away: "B", homeScore: 2, awayScore: null, status: "finished" },
      ],
      football,
    );
    expect(rows.every((r) => r.played === 0 && r.points === 0)).toBe(true);
  });

  it("ignores draws in games that don't allow them", () => {
    const rows = computeStandings(["A", "B"], [fin("A", 80, 80, "B"), fin("A", 90, 85, "B")], basketball);
    expect(rows[0]).toMatchObject({ id: "A", played: 1, points: 2 });
    expect(rows[1]).toMatchObject({ id: "B", played: 1, points: 1 }); // loss point
  });

  it("ignores matches involving unknown participants", () => {
    const rows = computeStandings(["A", "B"], [fin("A", 1, 0, "Z")], football);
    expect(rows.every((r) => r.played === 0)).toBe(true);
  });

  it("breaks points ties by goal difference by default", () => {
    // A and B both win once and lose once; B has the better difference
    const rows = computeStandings(
      ["A", "B", "C"],
      [fin("A", 1, 0, "B"), fin("B", 4, 0, "C"), fin("C", 1, 0, "A")],
      football,
    );
    // A: W vs B (+1), L vs C (-1)  = 3 pts, diff 0
    // B: L vs A (-1), W vs C (+4)  = 3 pts, diff +3
    // C: L vs B (-4), W vs A (+1)  = 3 pts, diff -3
    expect(rows.map((r) => r.id)).toEqual(["B", "A", "C"]);
  });

  it("head-to-head can override goal difference when ranked first", () => {
    const matches = [
      fin("A", 1, 0, "B"), // A beats B
      fin("A", 1, 0, "C"), // A beats C
      fin("D", 3, 0, "A"), // A loses to D  -> A: 6 pts, diff -1
      fin("B", 5, 0, "C"), // B beats C
      fin("B", 1, 0, "D"), // B beats D     -> B: 6 pts, diff +5
      fin("C", 0, 0, "D"), // C and D draw
    ];
    const byDiff = computeStandings(["A", "B", "C", "D"], matches, { ...football, tiebreakers: ["diff"] });
    expect(byDiff.map((r) => r.id).slice(0, 2)).toEqual(["B", "A"]);

    const byH2H = computeStandings(["A", "B", "C", "D"], matches, {
      ...football,
      tiebreakers: ["headToHead", "diff"],
    });
    expect(byH2H.map((r) => r.id).slice(0, 2)).toEqual(["A", "B"]);
  });

  it("records the last five results as form, oldest first", () => {
    const matches: MatchResult[] = [
      fin("A", 1, 0, "B"),
      fin("A", 0, 1, "B"),
      fin("A", 2, 2, "B"),
      fin("A", 3, 0, "B"),
      fin("A", 0, 3, "B"),
      fin("A", 1, 0, "B"),
    ];
    const [first] = computeStandings(["A", "B"], matches, football);
    expect(first.id).toBe("A");
    expect(first.form).toEqual(["L", "D", "W", "L", "W"]);
  });

  it("keeps input order when everything is tied, with sequential ranks", () => {
    const rows = computeStandings(["X", "Y", "Z"], [], football);
    expect(rows.map((r) => r.id)).toEqual(["X", "Y", "Z"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Knockout brackets
// ---------------------------------------------------------------------------

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);

describe("seedOrder", () => {
  it("pairs best with worst and keeps top seeds apart", () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedOrder(16).slice(0, 4)).toEqual([1, 16, 8, 9]);
  });
});

describe("generateKnockout", () => {
  it("has n-1 matches for a full bracket and no byes", () => {
    for (const n of [2, 4, 8, 16]) {
      const k = generateKnockout(ids(n));
      expect(k.matches).toHaveLength(n - 1);
      expect(k.byes).toHaveLength(0);
      expect(k.rounds).toBe(Math.log2(n));
    }
  });

  it("always creates n-1 matches, whatever the field size", () => {
    for (let n = 2; n <= 32; n++) expect(generateKnockout(ids(n)).matches).toHaveLength(n - 1);
  });

  it("gives byes to the top seeds and puts them straight into round 2", () => {
    const k = generateKnockout(ids(5)); // size 8, three byes
    expect(k.size).toBe(8);
    expect(k.byes.sort()).toEqual(["s1", "s2", "s3"]);
    const round1 = k.matches.filter((m) => m.round === 1);
    expect(round1).toHaveLength(1);
    expect([round1[0].home, round1[0].away].sort()).toEqual(["s4", "s5"]);
    const round2 = k.matches.filter((m) => m.round === 2);
    expect(round2.find((m) => m.pos === 0)).toMatchObject({ home: "s1", away: null });
    expect(round2.find((m) => m.pos === 1)).toMatchObject({ home: "s2", away: "s3" });
  });

  it("handles 3 entrants: one bye, one semi-final, a final", () => {
    const k = generateKnockout(ids(3));
    expect(k.matches).toHaveLength(2);
    expect(k.matches.find((m) => m.round === 2)).toMatchObject({ home: "s1", away: null });
  });

  it("every entrant appears exactly once in round 1 or as a bye", () => {
    for (let n = 2; n <= 32; n++) {
      const k = generateKnockout(ids(n));
      const seen = [...k.byes, ...k.matches.filter((m) => m.round === 1).flatMap((m) => [m.home, m.away])];
      expect(seen.sort()).toEqual(ids(n).sort());
    }
  });

  it("links every match except the final to exactly one slot in the next round", () => {
    for (const n of [2, 3, 5, 6, 8, 11, 16, 23]) {
      const k = generateKnockout(ids(n));
      const finals = k.matches.filter((m) => m.next === null);
      expect(finals).toHaveLength(1);
      expect(finals[0].round).toBe(k.rounds);
      const targets = k.matches.filter((m) => m.next).map((m) => `${m.next!.key}:${m.next!.slot}`);
      expect(new Set(targets).size).toBe(targets.length);
      for (const m of k.matches.filter((x) => x.round > 1)) {
        // a slot is either pre-filled by a bye or fed by a match, never both, never neither
        const home = m.home !== null || targets.includes(`${m.key}:home`);
        const away = m.away !== null || targets.includes(`${m.key}:away`);
        expect(home && away).toBe(true);
        expect(m.home !== null && targets.includes(`${m.key}:home`)).toBe(false);
        expect(m.away !== null && targets.includes(`${m.key}:away`)).toBe(false);
      }
    }
  });

  it("keeps the top two seeds on opposite halves", () => {
    const k = generateKnockout(ids(8));
    const half = (id: string) => {
      const m = k.matches.find((x) => x.round === 1 && (x.home === id || x.away === id))!;
      return m.pos < 2 ? "top" : "bottom";
    };
    expect(half("s1")).not.toBe(half("s2"));
  });

  it("rejects fewer than 2 or duplicates", () => {
    expect(() => generateKnockout(["a"])).toThrow();
    expect(() => generateKnockout(["a", "a"])).toThrow();
  });
});

describe("roundName", () => {
  it("names the late rounds", () => {
    expect(roundName(3, 3)).toBe("Final");
    expect(roundName(2, 3)).toBe("Semi-finals");
    expect(roundName(1, 3)).toBe("Quarter-finals");
    expect(roundName(1, 4)).toBe("Round of 16");
    expect(roundName(1, 5)).toBe("Round of 32");
    expect(roundName(1, 6)).toBe("Round 1");
  });
});

// Turns a draw into rows the way the wizard saves them.
function rowsFor(n: number): BracketRow[] {
  const k = generateKnockout(ids(n));
  const idOf = (key: string) => `m${key}`;
  return k.matches.map((m) => ({
    id: idOf(m.key),
    round: m.round,
    home_id: m.home,
    away_id: m.away,
    home_score: null,
    away_score: null,
    status: "scheduled" as const,
    next_match_id: m.next ? idOf(m.next.key) : null,
    next_slot: m.next ? m.next.slot : null,
  }));
}

describe("layoutBracket", () => {
  it("places matches in columns, leaving gaps where round 1 has byes", () => {
    const layout = layoutBracket(rowsFor(5))!;
    expect(layout.rounds).toBe(3);
    expect(layout.columns.map((c) => c.slots.length)).toEqual([4, 2, 1]);
    expect(layout.columns[0].slots.filter(Boolean)).toHaveLength(1);
    expect(layout.columns[0].slots[1]?.id).toBe("m1-1"); // seeds 4 v 5
  });

  it("matches the position each match was drawn at", () => {
    for (const n of [4, 7, 8, 13, 16]) {
      const rows = rowsFor(n);
      const layout = layoutBracket(rows)!;
      for (const c of layout.columns)
        c.slots.forEach((m, pos) => {
          if (m) expect(m.id).toBe(`m${c.round}-${pos}`);
        });
    }
  });

  it("returns null for rows that are not a bracket", () => {
    expect(layoutBracket([])).toBeNull();
    const rows = rowsFor(8);
    rows[0] = { ...rows[0], next_slot: null };
    expect(layoutBracket(rows)).toBeNull();
  });
});

describe("knockoutWinner", () => {
  const base = { home_id: "a", away_id: "b", home_score: 2, away_score: 1, status: "finished" as const };
  it("needs a finished, decisive match", () => {
    expect(knockoutWinner(base)).toBe("a");
    expect(knockoutWinner({ ...base, home_score: 0, away_score: 3 })).toBe("b");
    expect(knockoutWinner({ ...base, status: "live" })).toBeNull();
    expect(knockoutWinner({ ...base, away_score: 2 })).toBeNull();
    expect(knockoutWinner({ ...base, away_id: null })).toBeNull();
  });
});

describe("advanceKnockout", () => {
  const finish = (rows: BracketRow[], id: string, h: number, a: number) =>
    advanceKnockout(rows, id, { status: "finished", home_score: h, away_score: a });

  it("moves the winner into the right slot of the next match", () => {
    const rows = rowsFor(4); // s1 v s4, s2 v s3 -> final
    const r = finish(rows, "m1-0", 3, 1);
    expect(r.error).toBeNull();
    expect(r.rows.find((m) => m.id === "m2-0")).toMatchObject({ home_id: "s1", away_id: null });
    const r2 = finish(r.rows, "m1-1", 0, 2);
    expect(r2.rows.find((m) => m.id === "m2-0")).toMatchObject({ home_id: "s1", away_id: "s3" });
  });

  it("refuses a result with a missing score", () => {
    const r = advanceKnockout(rowsFor(4), "m1-0", { status: "finished", home_score: 2 });
    expect(r.error).toBe("Enter both scores first.");
  });

  it("refuses a draw", () => {
    const r = finish(rowsFor(4), "m1-0", 1, 1);
    expect(r.error).toMatch(/cannot end level/);
    expect(r.rows).toEqual(rowsFor(4));
  });

  it("changes the next slot when the winner is corrected before the next match starts", () => {
    let rows = finish(rowsFor(4), "m1-0", 3, 1).rows;
    rows = finish(rows, "m1-0", 1, 2).rows;
    expect(rows.find((m) => m.id === "m2-0")!.home_id).toBe("s4");
  });

  it("keeps the next slot when only the score changes", () => {
    let rows = finish(rowsFor(4), "m1-0", 3, 1).rows;
    rows = finish(rows, "m1-0", 5, 0).rows;
    expect(rows.find((m) => m.id === "m2-0")!.home_id).toBe("s1");
  });

  it("clears the slot when a result is cleared", () => {
    let rows = finish(rowsFor(4), "m1-0", 3, 1).rows;
    rows = advanceKnockout(rows, "m1-0", { status: "scheduled", home_score: null, away_score: null }).rows;
    expect(rows.find((m) => m.id === "m2-0")!.home_id).toBeNull();
  });

  it("blocks a winner change once the next match has started", () => {
    let rows = finish(rowsFor(4), "m1-0", 3, 1).rows;
    rows = finish(rows, "m1-1", 2, 0).rows;
    rows = advanceKnockout(rows, "m2-0", { status: "live", home_score: 0, away_score: 0 }).rows;
    const r = finish(rows, "m1-0", 0, 4);
    expect(r.error).toMatch(/next round has already started/);
    expect(r.rows).toBe(rows);
    // but correcting only the score is fine
    expect(finish(rows, "m1-0", 6, 1).error).toBeNull();
  });

  it("plays a whole 6-team bracket to a champion", () => {
    let rows = rowsFor(6);
    for (let guard = 0; guard < 20; guard++) {
      const open = rows.find((m) => m.status !== "finished" && m.home_id && m.away_id);
      if (!open) break;
      const r = finish(rows, open.id, 2, 1); // home side always wins
      expect(r.error).toBeNull();
      rows = r.rows;
    }
    const final = layoutBracket(rows)!.final;
    expect(final.status).toBe("finished");
    expect(knockoutWinner(final)).toBe("s1");
    expect(rows.every((m) => m.status === "finished")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Groups, then knockout
// ---------------------------------------------------------------------------
describe("groupPlanProblem", () => {
  it("accepts sensible plans", () => {
    expect(groupPlanProblem(8, 2, 2)).toBeNull();
    expect(groupPlanProblem(16, 4, 2)).toBeNull();
    expect(groupPlanProblem(4, 2, 1)).toBeNull();
    expect(groupPlanProblem(9, 3, 1)).toBeNull();
  });
  it("rejects plans that cannot work", () => {
    expect(groupPlanProblem(8, 1, 2)).toMatch(/between 2 and 8/);
    expect(groupPlanProblem(40, 9, 2)).toMatch(/between 2 and 8/);
    expect(groupPlanProblem(8, 2, 0)).toMatch(/Between 1 and 4/);
    expect(groupPlanProblem(8, 2, 5)).toMatch(/Between 1 and 4/);
    expect(groupPlanProblem(6, 3, 2)).toMatch(/too few/); // groups of 2 cannot send 2 through
    expect(groupPlanProblem(5, 2, 2)).toMatch(/too few/); // smallest group has 2
  });
});

describe("assignGroups", () => {
  it("snakes the seeds", () => {
    const g = assignGroups(ids(8), 2);
    expect(g[0].ids).toEqual(["s1", "s4", "s5", "s8"]);
    expect(g[1].ids).toEqual(["s2", "s3", "s6", "s7"]);
    expect(g.map((x) => x.label)).toEqual(["A", "B"]);
  });
  it("keeps group sizes within one of each other and uses everyone once", () => {
    for (let n = 4; n <= 32; n++)
      for (let groups = 2; groups <= 8; groups++) {
        const g = assignGroups(ids(n), groups);
        const sizes = g.map((x) => x.ids.length);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        expect(g.flatMap((x) => x.ids).sort()).toEqual(ids(n).sort());
      }
  });
  it("splits an odd number as evenly as possible", () => {
    const g = assignGroups(ids(7), 2);
    expect(g.map((x) => x.ids.length).sort()).toEqual([3, 4]);
  });
});

describe("generateGroupStage", () => {
  it("plays every pair inside a group exactly once and never across groups", () => {
    const groups = assignGroups(ids(10), 3);
    const { fixtures } = generateGroupStage(groups);
    const expected = groups.reduce((n, g) => n + (g.ids.length * (g.ids.length - 1)) / 2, 0);
    expect(fixtures).toHaveLength(expected);
    const groupOf = new Map(groups.flatMap((g) => g.ids.map((id) => [id, g.label] as const)));
    const seen = new Set<string>();
    for (const f of fixtures) {
      expect(groupOf.get(f.home)).toBe(f.group);
      expect(groupOf.get(f.away)).toBe(f.group);
      const key = [f.group, ...[f.home, f.away].sort()].join("|");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
  it("lines rounds up across groups and never has a team twice in one round", () => {
    const { fixtures, rounds } = generateGroupStage(assignGroups(ids(8), 2));
    expect(rounds).toBe(3);
    for (let r = 1; r <= rounds; r++) {
      const inRound = fixtures.filter((f) => f.round === r);
      expect(inRound).toHaveLength(4); // 2 per group
      const players = inRound.flatMap((f) => [f.home, f.away]);
      expect(new Set(players).size).toBe(players.length);
    }
  });
  it("doubles the fixtures for home and away", () => {
    const g = assignGroups(ids(8), 2);
    expect(generateGroupStage(g, { doubleRound: true }).fixtures).toHaveLength(24);
  });
});

describe("seedQualifiers", () => {
  const row = (id: string, rank: number, points: number, diff = 0, f = 0): StandingRow => ({
    id, rank, played: 3, won: 0, drawn: 0, lost: 0, for: f, against: 0, diff, points, form: [],
  });
  const tables = [
    { label: "A", rows: [row("a1", 1, 9, 5, 7), row("a2", 2, 4)] },
    { label: "B", rows: [row("b1", 1, 7, 3, 5), row("b2", 2, 6, 2)] },
    { label: "C", rows: [row("c1", 1, 9, 6, 8), row("c2", 2, 6, 2)] },
  ];
  it("puts every group winner ahead of every runner-up", () => {
    const s = seedQualifiers(tables, 2);
    expect(s.slice(0, 3).sort()).toEqual(["a1", "b1", "c1"]);
    expect(s.slice(3).sort()).toEqual(["a2", "b2", "c2"]);
  });
  it("ranks inside a finishing place by points, then difference, then goals, then group", () => {
    const s = seedQualifiers(tables, 2);
    expect(s.slice(0, 3)).toEqual(["c1", "a1", "b1"]); // 9 pts +6, 9 pts +5, 7 pts
    expect(s.slice(3)).toEqual(["b2", "c2", "a2"]); // 6 pts +2 (B before C by group), then 4 pts
  });
  it("takes only as many as advance", () => {
    expect(seedQualifiers(tables, 1)).toHaveLength(3);
  });
  it("keeps group rivals apart in round 1 of a 2-group, 2-advance bracket", () => {
    const t = [
      { label: "A", rows: [row("a1", 1, 9), row("a2", 2, 3)] },
      { label: "B", rows: [row("b1", 1, 7), row("b2", 2, 4)] },
    ];
    const k = generateKnockout(seedQualifiers(t, 2));
    for (const m of k.matches.filter((x) => x.round === 1)) {
      expect(m.home![0]).not.toBe(m.away![0]);
    }
  });
  it("swaps runners-up to avoid a same-group clash and keeps winners ahead", () => {
    // 3 groups, 2 through: the weakest runner-up would face its own group winner
    const t = [
      { label: "A", rows: [row("a1", 1, 9), row("a2", 2, 5)] },
      { label: "B", rows: [row("b1", 1, 8), row("b2", 2, 4)] },
      { label: "C", rows: [row("c1", 1, 7), row("c2", 2, 1)] },
    ];
    const seeds = seedQualifiers(t, 2);
    expect(seeds.slice(0, 3)).toEqual(["a1", "b1", "c1"]);
    const k = generateKnockout(seeds);
    for (const m of k.matches.filter((x) => x.round === 1)) expect(m.home![0]).not.toBe(m.away![0]);
  });
  it("leaves the order alone when there is no clash", () => {
    const t = [
      { label: "A", rows: [row("a1", 1, 9), row("a2", 2, 6)] },
      { label: "B", rows: [row("b1", 1, 8), row("b2", 2, 5)] },
    ];
    expect(seedQualifiers(t, 2)).toEqual(["a1", "b1", "a2", "b2"]);
  });
  it("keeps group rivals apart for 4 groups with 2 advancing", () => {
    const t = ["A", "B", "C", "D"].map((l, i) => ({
      label: l,
      rows: [row(`${l.toLowerCase()}1`, 1, 9 - i), row(`${l.toLowerCase()}2`, 2, 4 - i)],
    }));
    const k = generateKnockout(seedQualifiers(t, 2));
    for (const m of k.matches.filter((x) => x.round === 1)) expect(m.home![0]).not.toBe(m.away![0]);
  });
});

// ---------------------------------------------------------------------------
// All-time rankings
// ---------------------------------------------------------------------------
import { buildRankings, championOf, recordFor, rankingKey, sortRankings, type RankingRow, type RankingTournament } from "./tournament";

const football2 = { slug: "football", name: "Football", category: "sport", allowsDraws: true, ptsWin: 3, ptsDraw: 1, ptsLoss: 0 };
const fifa = { slug: "fifa", name: "FIFA", category: "esports", allowsDraws: true, ptsWin: 3, ptsDraw: 1, ptsLoss: 0 };

function rrTournament(id: string, names: string[], scores: [number, number, number, number][], status: "live" | "finished", game = football2): RankingTournament {
  // scores: [homeIdx, awayIdx, homeScore, awayScore]
  const participants = names.map((n, i) => ({ id: `${id}-p${i}`, name: n }));
  return {
    id, slug: id, name: `Cup ${id}`, status, format: "round_robin", game, participants,
    matches: scores.map(([h, a, hs, as], i) => ({
      id: `${id}-m${i}`, round: 1, group_label: null, home_id: participants[h].id, away_id: participants[a].id,
      home_score: hs, away_score: as, status: "finished" as const, next_match_id: null, next_slot: null,
    })),
  };
}

describe("rankingKey", () => {
  it("ignores case and spacing", () => {
    expect(rankingKey("  Computer   Eng ")).toBe("computer eng");
    expect(rankingKey("COMPUTER ENG")).toBe(rankingKey("computer eng"));
  });
});

describe("championOf", () => {
  it("is the league leader of a finished round robin, nobody while live", () => {
    const t = rrTournament("a", ["X", "Y"], [[0, 1, 2, 0]], "finished");
    expect(championOf(t)).toBe("a-p0");
    expect(championOf({ ...t, status: "live" })).toBeNull();
  });
  it("is nobody for a finished round robin with no results", () => {
    expect(championOf(rrTournament("a", ["X", "Y"], [], "finished"))).toBeNull();
  });
  it("is the final winner of a knockout and of the bracket stage of groups-then-knockout", () => {
    const k = generateKnockout(["s1", "s2"]);
    const bracket = k.matches.map((m) => ({
      id: `k${m.key}`, round: m.round, group_label: null as string | null, home_id: m.home, away_id: m.away,
      home_score: 1 as number | null, away_score: 3 as number | null, status: "finished" as const,
      next_match_id: null, next_slot: null,
    }));
    const base: RankingTournament = {
      id: "k", slug: "k", name: "K", status: "finished", format: "knockout", game: football2,
      participants: [{ id: "s1", name: "One" }, { id: "s2", name: "Two" }], matches: bracket,
    };
    expect(championOf(base)).toBe("s2");
    const groupMatch = { ...bracket[0], id: "g1", group_label: "A", home_score: 9, away_score: 0 };
    expect(championOf({ ...base, format: "groups_knockout", matches: [groupMatch, ...bracket.map((m) => ({ ...m }))] })).toBe("s2");
    expect(championOf({ ...base, format: "groups_knockout", matches: [groupMatch] })).toBeNull();
  });
});

describe("buildRankings", () => {
  const t1 = rrTournament("t1", ["Computer Eng", "Law", "Medicine"], [[0, 1, 2, 0], [0, 2, 1, 1], [1, 2, 0, 3]], "finished");
  const t2 = rrTournament("t2", ["computer eng", "Law  ", "Arts"], [[0, 1, 0, 1], [2, 0, 0, 4]], "finished");

  it("merges entrants by name inside one game and sums their results", () => {
    const { games } = buildRankings([t1, t2]);
    expect(games).toHaveLength(1);
    const ce = games[0].rows.find((r) => r.key === "computer eng")!;
    expect(ce).toMatchObject({ tournaments: 2, played: 4, won: 2, drawn: 1, lost: 1, for: 7, against: 2, diff: 5 });
    expect(ce.winRate).toBeCloseTo(0.5);
    const law = games[0].rows.find((r) => r.key === "law")!;
    expect(law).toMatchObject({ played: 3, won: 1, lost: 2 });
  });

  it("counts titles from finished tournaments only", () => {
    const live = rrTournament("t3", ["Computer Eng", "Law"], [[0, 1, 5, 0]], "live");
    const { games, champions } = buildRankings([t1, t2, live]);
    const ce = games[0].rows.find((r) => r.key === "computer eng")!;
    expect(ce.titles).toBe(1); // t1 went to Medicine on goal difference; Computer Eng won t2
    expect(games[0].rows.find((r) => r.key === "medicine")!.titles).toBe(1);
    expect(champions.map((c) => [c.tournamentId, c.name])).toEqual([["t1", "Medicine"], ["t2", "Computer Eng"]]);
    // the live tournament's finished match still counts towards results
    expect(ce.played).toBe(5);
  });

  it("keeps different games apart, busiest game first", () => {
    const f = rrTournament("f1", ["Dari", "Tobi"], [[0, 1, 3, 1]], "finished", fifa);
    const { games } = buildRankings([f, t1, t2]);
    expect(games.map((g) => g.slug)).toEqual(["football", "fifa"]);
    expect(games[1].rows.map((r) => r.name)).toEqual(["Dari", "Tobi"]);
  });

  it("uses the most common spelling", () => {
    const a = rrTournament("a", ["law"], [], "live");
    const b = rrTournament("b", ["Law", "X"], [[0, 1, 1, 0]], "live");
    const c = rrTournament("c", ["Law", "Y"], [[0, 1, 1, 0]], "live");
    expect(buildRankings([a, b, c]).games[0].rows.find((r) => r.key === "law")!.name).toBe("Law");
  });

  it("ignores unfinished, unscored and TBD matches and entrants who never played", () => {
    const t = rrTournament("u", ["A", "B", "C"], [[0, 1, 1, 0]], "live");
    t.matches.push({ id: "x1", round: 1, group_label: null, home_id: t.participants[0].id, away_id: t.participants[2].id, home_score: 4, away_score: 0, status: "live", next_match_id: null, next_slot: null });
    t.matches.push({ id: "x2", round: 1, group_label: null, home_id: null, away_id: t.participants[2].id, home_score: null, away_score: null, status: "scheduled", next_match_id: null, next_slot: null });
    const rows = buildRankings([t]).games[0].rows;
    expect(rows.map((r) => r.name).sort()).toEqual(["A", "B"]); // C never played a finished match
    expect(rows.find((r) => r.name === "A")!.played).toBe(1);
  });

  it("returns nothing for no data", () => {
    expect(buildRankings([])).toEqual({ games: [], champions: [] });
  });

  it("counts a knockout champion and every bracket match", () => {
    const k = generateKnockout(["s1", "s2", "s3", "s4"]);
    const score = (m: (typeof k.matches)[number]) => (m.round === 1 ? [2, 0] : [1, 0]);
    let rows: any[] = k.matches.map((m) => ({
      id: `k${m.key}`, round: m.round, group_label: null, home_id: m.home, away_id: m.away, home_score: null, away_score: null,
      status: "scheduled", next_match_id: m.next ? `k${m.next.key}` : null, next_slot: m.next ? m.next.slot : null,
    }));
    for (const m of [...k.matches].sort((a, b) => a.round - b.round)) rows = advanceKnockout(rows, `k${m.key}`, { status: "finished", home_score: score(m)[0], away_score: score(m)[1] }).rows;
    const t: RankingTournament = {
      id: "k", slug: "k", name: "K", status: "finished", format: "knockout", game: fifa,
      participants: ["One", "Two", "Three", "Four"].map((n, i) => ({ id: `s${i + 1}`, name: n })), matches: rows,
    };
    const { games, champions } = buildRankings([t]);
    expect(champions[0].name).toBe("One");
    const one = games[0].rows.find((r) => r.name === "One")!;
    expect(one).toMatchObject({ played: 2, won: 2, titles: 1 });
  });
});

describe("sortRankings", () => {
  const row = (name: string, o: Partial<RankingRow>): RankingRow => ({
    key: name, name, tournaments: 1, played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0, diff: 0, titles: 0, winRate: 0, ...o,
  });
  const rows = [
    row("Steady", { played: 10, won: 5, winRate: 0.5, titles: 0 }),
    row("Lucky", { played: 1, won: 1, winRate: 1, titles: 0 }),
    row("Champ", { played: 4, won: 2, winRate: 0.5, titles: 2 }),
  ];
  it("sorts by titles, wins or win rate", () => {
    expect(sortRankings(rows, "titles").map((r) => r.name)).toEqual(["Champ", "Steady", "Lucky"]);
    expect(sortRankings(rows, "wins").map((r) => r.name)).toEqual(["Steady", "Champ", "Lucky"]);
    expect(sortRankings(rows, "winRate").map((r) => r.name)).toEqual(["Lucky", "Steady", "Champ"]);
  });
  it("does not change the input", () => {
    const copy = [...rows];
    sortRankings(rows, "wins");
    expect(rows).toEqual(copy);
  });
});

describe("account-linked entrants", () => {
  const ft = (id: string, a: string, b: string, h: number, aw: number) => ({
    id, round: 1, group_label: null, home_id: a, away_id: b, home_score: h, away_score: aw, status: "finished" as const, next_match_id: null, next_slot: null,
  });
  const game = { slug: "fifa", name: "FIFA", category: "esports", allowsDraws: true, ptsWin: 3, ptsDraw: 1, ptsLoss: 0 };
  const t = (id: string, parts: { id: string; name: string; user_id?: string | null }[], matches: ReturnType<typeof ft>[]) => ({
    id, slug: id, name: id, status: "finished" as const, format: "round_robin" as const, game, participants: parts, matches,
  });

  it("merges one account across different spellings", () => {
    const r = buildRankings([
      t("t1", [{ id: "a", name: "@dari", user_id: "U1" }, { id: "b", name: "Ola" }], [ft("m1", "a", "b", 2, 0)]),
      t("t2", [{ id: "c", name: "@dari_new", user_id: "U1" }, { id: "d", name: "Ola" }], [ft("m2", "c", "d", 1, 0)]),
    ]);
    const rows = r.games[0].rows;
    expect(rows.filter((x) => x.name.startsWith("@"))).toHaveLength(1);
    expect(rows.find((x) => x.key === "u:U1")).toMatchObject({ won: 2, tournaments: 2, titles: 2 });
  });
  it("keeps a plain name separate from an account with the same name", () => {
    const r = buildRankings([
      t("t1", [{ id: "a", name: "dari", user_id: "U1" }, { id: "b", name: "Ola" }], [ft("m1", "a", "b", 1, 0)]),
      t("t2", [{ id: "c", name: "Dari" }, { id: "d", name: "Ola" }], [ft("m2", "c", "d", 1, 0)]),
    ]);
    expect(r.games[0].rows.filter((x) => x.name.toLowerCase() === "dari")).toHaveLength(2);
  });
  it("keeps two different accounts with the same display name apart", () => {
    const r = buildRankings([
      t("t1", [{ id: "a", name: "sam", user_id: "U1" }, { id: "b", name: "sam", user_id: "U2" }], [ft("m1", "a", "b", 3, 0)]),
    ]);
    expect(r.games[0].rows).toHaveLength(2);
  });
  it("accountUsername only accepts @ plus a valid username", async () => {
    const { accountUsername } = await import("./tournament");
    expect(accountUsername("@Dari_1")).toBe("dari_1");
    expect(accountUsername("dari")).toBeNull();
    expect(accountUsername("@ab")).toBeNull();
    expect(accountUsername("@a b c")).toBeNull();
    expect(accountUsername("@a-b-c")).toBeNull();
  });
});

describe("recordFor", () => {
  const ft = (id: string, a: string, b: string, h: number, aw: number) => ({
    id, round: 1, group_label: null, home_id: a, away_id: b, home_score: h, away_score: aw, status: "finished" as const, next_match_id: null, next_slot: null,
  });
  const g = (slug: string, name: string) => ({ slug, name, category: "esports", allowsDraws: true, ptsWin: 3, ptsDraw: 1, ptsLoss: 0 });
  const t = (id: string, game: ReturnType<typeof g>, parts: { id: string; name: string; user_id?: string | null }[], matches: ReturnType<typeof ft>[]) => ({
    id, slug: id, name: id, status: "finished" as const, format: "round_robin" as const, game, participants: parts, matches,
  });

  it("lists the account in each game with rank, best first, and ignores other people", () => {
    const { games } = buildRankings([
      t("t1", g("fifa", "FIFA"), [{ id: "a", name: "@dari", user_id: "U1" }, { id: "b", name: "Ola", user_id: "U2" }], [ft("m1", "a", "b", 2, 0)]),
      t("t2", g("cod", "Call of Duty"), [{ id: "c", name: "@dari", user_id: "U1" }, { id: "d", name: "Ola", user_id: "U2" }], [ft("m2", "c", "d", 0, 1)]),
    ]);
    const rec = recordFor(games, "U1");
    expect(rec.map((r) => [r.game.slug, r.rank, r.of, r.row.titles])).toEqual([["fifa", 1, 2, 1], ["cod", 2, 2, 0]]);
    expect(recordFor(games, "nobody")).toEqual([]);
  });
  it("does not pick up a plain name that happens to match", () => {
    const { games } = buildRankings([
      t("t1", g("fifa", "FIFA"), [{ id: "a", name: "dari" }, { id: "b", name: "Ola" }], [ft("m1", "a", "b", 2, 0)]),
    ]);
    expect(recordFor(games, "U1")).toEqual([]);
  });
});

describe("linked usernames in rankings", () => {
  const ft = (id: string, a: string, b: string, h: number, aw: number) => ({
    id, round: 1, group_label: null, home_id: a, away_id: b, home_score: h, away_score: aw, status: "finished" as const, next_match_id: null, next_slot: null,
  });
  const game = { slug: "fifa", name: "FIFA", category: "esports", allowsDraws: true, ptsWin: 3, ptsDraw: 1, ptsLoss: 0 };
  const t = (id: string, parts: { id: string; name: string; user_id?: string | null; username?: string | null }[], matches: ReturnType<typeof ft>[]) => ({
    id, slug: id, name: id, status: "finished" as const, format: "round_robin" as const, game, participants: parts, matches,
  });

  it("shows the current username after a rename and exposes it for the player link", () => {
    // t1 is newest (passed first): the account is now @dari_new; the older tournament still stored @dari
    const r = buildRankings([
      t("t1", [{ id: "a", name: "@dari_new", user_id: "U1", username: "dari_new" }, { id: "b", name: "Ola" }], [ft("m1", "a", "b", 1, 0)]),
      t("t2", [{ id: "c", name: "@dari", user_id: "U1", username: "dari_new" }, { id: "d", name: "Ola" }], [ft("m2", "c", "d", 1, 0)]),
    ]);
    const row = r.games[0].rows.find((x) => x.key === "u:U1")!;
    expect(row).toMatchObject({ name: "@dari_new", username: "dari_new", titles: 2 });
    expect(r.champions.map((c) => [c.name, c.key])).toEqual([["@dari_new", "u:U1"], ["@dari_new", "u:U1"]]);
  });
  it("plain names carry no username", () => {
    const r = buildRankings([t("t1", [{ id: "a", name: "Blessing" }, { id: "b", name: "Ola" }], [ft("m1", "a", "b", 1, 0)])]);
    expect(r.games[0].rows[0].username).toBeUndefined();
    expect(r.champions[0].key).toBe("blessing");
  });
});

describe("link status in rankings", () => {
  const ft = (id: string, a: string, b: string, h: number, aw: number) => ({
    id, round: 1, group_label: null, home_id: a, away_id: b, home_score: h, away_score: aw, status: "finished" as const, next_match_id: null, next_slot: null,
  });
  const game = { slug: "fifa", name: "FIFA", category: "esports", allowsDraws: true, ptsWin: 3, ptsDraw: 1, ptsLoss: 0 };
  const t = (parts: { id: string; name: string; user_id?: string | null; username?: string | null; link_status?: string | null }[]) => ({
    id: "t", slug: "t", name: "t", status: "finished" as const, format: "round_robin" as const, game, participants: parts, matches: [ft("m", "a", "b", 1, 0)],
  });
  const rowsFor = (status: string) => buildRankings([t([{ id: "a", name: "@dari", user_id: "U1", username: "dari", link_status: status }, { id: "b", name: "Ola" }])]).games[0].rows;

  it("counts an accepted link as the account", () => {
    expect(rowsFor("accepted")[0]).toMatchObject({ key: "u:U1", username: "dari" });
  });
  for (const status of ["pending", "declined", "none"]) {
    it(`treats a ${status} link as a plain name with no player page`, () => {
      const row = rowsFor(status).find((r) => r.name === "@dari")!;
      expect(row.key).toBe("@dari");
      expect(row.username).toBeUndefined();
    });
  }
});

describe("archiving", () => {
  const HOUR = 3600_000;
  const finishedAt = "2026-10-10T12:00:00.000Z";
  const t0 = new Date(finishedAt).getTime();
  const fin = { status: "finished", finished_at: finishedAt };

  it("auto: not archived until 24 hours after finishing, then archived", async () => {
    const { isArchived } = await import("./tournament");
    expect(isArchived({ ...fin, archive_mode: "auto" }, t0)).toBe(false);
    expect(isArchived({ ...fin, archive_mode: "auto" }, t0 + 24 * HOUR - 1)).toBe(false);
    expect(isArchived({ ...fin, archive_mode: "auto" }, t0 + 24 * HOUR)).toBe(true);
    expect(isArchived({ ...fin, archive_mode: "auto" }, t0 + 30 * 24 * HOUR)).toBe(true);
  });
  it("a missing mode means auto", async () => {
    const { isArchived } = await import("./tournament");
    expect(isArchived(fin, t0 + 25 * HOUR)).toBe(true);
    expect(isArchived({ ...fin, archive_mode: null }, t0 + 25 * HOUR)).toBe(true);
  });
  it("live, draft and not-yet-stamped tournaments never auto-archive", async () => {
    const { isArchived } = await import("./tournament");
    const late = t0 + 1000 * HOUR;
    expect(isArchived({ status: "live", finished_at: null, archive_mode: "auto" }, late)).toBe(false);
    expect(isArchived({ status: "draft", finished_at: null }, late)).toBe(false);
    expect(isArchived({ status: "finished", finished_at: null }, late)).toBe(false);
    expect(isArchived({ status: "finished", finished_at: "not a date" }, late)).toBe(false);
  });
  it("archived always archives (even live); pinned never does", async () => {
    const { isArchived } = await import("./tournament");
    const late = t0 + 1000 * HOUR;
    expect(isArchived({ status: "live", archive_mode: "archived" }, t0)).toBe(true);
    expect(isArchived({ ...fin, archive_mode: "pinned" }, late)).toBe(false);
  });
  it("archiveDueAt gives the moment, and null when nothing is scheduled", async () => {
    const { archiveDueAt } = await import("./tournament");
    expect(archiveDueAt({ ...fin, archive_mode: "auto" })?.toISOString()).toBe("2026-10-11T12:00:00.000Z");
    expect(archiveDueAt({ ...fin, archive_mode: "pinned" })).toBeNull();
    expect(archiveDueAt({ ...fin, archive_mode: "archived" })).toBeNull();
    expect(archiveDueAt({ status: "live", archive_mode: "auto" })).toBeNull();
  });
  it("summaries carry the archived flag", async () => {
    const { summarizeTournaments } = await import("./supabase");
    const base = { id: "1", slug: "a", name: "A", format: "knockout" as const, created_at: "", game: { name: "FIFA", slug: "fifa", category: "esports" as const }, participants: [{ count: 4 }], matches: [] };
    const rows = [
      { ...base, id: "old", status: "finished" as const, finished_at: finishedAt, archive_mode: "auto" as const },
      { ...base, id: "new", status: "finished" as const, finished_at: finishedAt, archive_mode: "auto" as const },
      { ...base, id: "live", status: "live" as const },
    ];
    const out = summarizeTournaments(rows, t0 + 25 * HOUR);
    expect(out.map((s) => [s.id, s.archived]).sort()).toEqual([["live", false], ["new", true], ["old", true]]);
    expect(summarizeTournaments([rows[0]], t0 + HOUR)[0].archived).toBe(false);
  });
});
