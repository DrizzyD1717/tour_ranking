import { describe, expect, it } from "vitest";
import {
  computeStandings,
  generateRoundRobin,
  type GameRules,
  type MatchResult,
} from "./tournament";

const football: GameRules = {
  allowsDraws: true,
  ptsWin: 3,
  ptsDraw: 1,
  ptsLoss: 0,
};
const basketball: GameRules = {
  allowsDraws: false,
  ptsWin: 2,
  ptsDraw: 0,
  ptsLoss: 1,
};

const teams = (n: number) => Array.from({ length: n }, (_, i) => `T${i + 1}`);

const fin = (
  home: string,
  homeScore: number,
  awayScore: number,
  away: string,
): MatchResult => ({
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

      const pairs = new Set(
        fixtures.map((f) => [f.home, f.away].sort().join("|")),
      );
      expect(pairs.size).toBe(fixtures.length);

      // nobody plays twice in a round, and nobody both plays and has a bye
      for (let r = 1; r <= rounds; r++) {
        const seen = [
          ...fixtures
            .filter((f) => f.round === r)
            .flatMap((f) => [f.home, f.away]),
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
        expect(
          Math.abs((home.get(id) as number) - (away.get(id) as number)),
        ).toBeLessThanOrEqual(2);
      }
    });
  }

  it("double round adds mirrored return legs", () => {
    const { fixtures, rounds } = generateRoundRobin(teams(4), {
      doubleRound: true,
    });
    expect(fixtures).toHaveLength(12);
    expect(rounds).toBe(6);
    for (const f of fixtures.filter((x) => x.leg === 1)) {
      const back = fixtures.find(
        (x) => x.leg === 2 && x.home === f.away && x.away === f.home,
      );
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
    const rows = computeStandings(
      ["A", "B", "C"],
      [fin("A", 2, 0, "B"), fin("B", 1, 1, "C"), fin("A", 3, 1, "C")],
      football,
    );
    // B and C both end on 1 point and -2 goal difference; C scored more (2 vs 1), so C ranks higher.
    expect(rows.map((r) => r.id)).toEqual(["A", "C", "B"]);
    const a = rows[0];
    expect(a).toMatchObject({
      played: 2,
      won: 2,
      points: 6,
      for: 5,
      against: 1,
      diff: 4,
      rank: 1,
    });
    expect(rows[1]).toMatchObject({
      id: "C",
      points: 1,
      drawn: 1,
      lost: 1,
      for: 2,
      diff: -2,
    });
    expect(rows[2]).toMatchObject({
      id: "B",
      points: 1,
      drawn: 1,
      lost: 1,
      for: 1,
      diff: -2,
    });
  });

  it("ignores unfinished and incomplete matches", () => {
    const rows = computeStandings(
      ["A", "B"],
      [
        { home: "A", away: "B", homeScore: 5, awayScore: 0, status: "live" },
        {
          home: "A",
          away: "B",
          homeScore: null,
          awayScore: null,
          status: "scheduled",
        },
        {
          home: "A",
          away: "B",
          homeScore: 2,
          awayScore: null,
          status: "finished",
        },
      ],
      football,
    );
    expect(rows.every((r) => r.played === 0 && r.points === 0)).toBe(true);
  });

  it("ignores draws in games that don't allow them", () => {
    const rows = computeStandings(
      ["A", "B"],
      [fin("A", 80, 80, "B"), fin("A", 90, 85, "B")],
      basketball,
    );
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
    const byDiff = computeStandings(["A", "B", "C", "D"], matches, {
      ...football,
      tiebreakers: ["diff"],
    });
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
