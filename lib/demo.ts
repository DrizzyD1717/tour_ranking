import {
  advanceKnockout,
  assignGroups,
  generateGroupStage,
  generateKnockout,
  generateRoundRobin,
  type BracketRow,
  type RankingTournament,
} from "./tournament";
import type { MatchRow, ParticipantRow, TournamentBundle } from "./supabase";

/**
 * Fake six-team football league so /tournaments/demo works with no database.
 * Deterministic on purpose: the server and browser must render identical data.
 * Delete this file once real tournaments exist.
 */
export function buildDemoBundle(): TournamentBundle {
  const names = ["Computer Eng", "Mechanical", "Law Lions", "Medicine", "Arts Athletic", "Sciences"];

  const participants: ParticipantRow[] = names.map((name, i) => ({
    id: `p${i + 1}`,
    tournament_id: "demo",
    name,
    group_label: null,
    seed: i + 1,
  }));

  const { fixtures } = generateRoundRobin(participants.map((p) => p.id));

  let seed = 7;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const goals = () => Math.floor(rnd() ** 1.6 * 5);

  const firstOfRound3 = fixtures.findIndex((f) => f.round === 3);

  const matches: MatchRow[] = fixtures.map((f, i) => {
    const finished = f.round <= 2;
    const live = i === firstOfRound3;
    const day = 17 + (f.round - 1) * 7;
    return {
      id: `m${i + 1}`,
      tournament_id: "demo",
      round: f.round,
      group_label: null,
      home_id: f.home,
      away_id: f.away,
      home_score: finished || live ? goals() : null,
      away_score: finished || live ? goals() : null,
      status: finished ? "finished" : live ? "live" : "scheduled",
      scheduled_at: `2026-10-${String(day).padStart(2, "0")}T${14 + (i % 3)}:00:00Z`,
      next_match_id: null,
      next_slot: null,
    };
  });

  return {
    tournament: {
      id: "demo",
      slug: "demo",
      name: "Faculty Cup",
      format: "round_robin",
      double_round: false,
      advance_per_group: null,
      status: "live",
      visibility: "public",
      starts_at: "2026-10-17T14:00:00Z",
      game: {
        id: "g-football",
        slug: "football",
        name: "Football",
        category: "sport",
        score_label: "Goals",
        allows_draws: true,
        pts_win: 3,
        pts_draw: 1,
        pts_loss: 0,
      },
    },
    participants,
    matches,
  };
}

/**
 * Fake six-player FIFA knockout so /tournaments/demo-knockout works with no database.
 * Seeds 1 and 2 have byes; round 1 is played and the first semi-final is live.
 */
export function buildDemoKnockoutBundle(): TournamentBundle {
  const names = ["Dari", "Tobi", "Amaka", "Femi", "Zainab", "Chidi"];
  const participants: ParticipantRow[] = names.map((name, i) => ({
    id: `p${i + 1}`,
    tournament_id: "demo-knockout",
    name,
    group_label: null,
    seed: i + 1,
  }));

  const draw = generateKnockout(participants.map((p) => p.id));
  let rows: (BracketRow & { tournament_id: string; group_label: string | null; scheduled_at: string | null })[] =
    draw.matches.map((m) => ({
      id: `k${m.key}`,
      tournament_id: "demo-knockout",
      round: m.round,
      group_label: null,
      home_id: m.home,
      away_id: m.away,
      home_score: null,
      away_score: null,
      status: "scheduled",
      scheduled_at: null,
      next_match_id: m.next ? `k${m.next.key}` : null,
      next_slot: m.next ? m.next.slot : null,
    }));

  const play = (id: string, patch: Parameters<typeof advanceKnockout>[2]) => {
    rows = advanceKnockout(rows, id, patch).rows;
  };
  const scores: Record<string, [number, number]> = { "1-1": [2, 1], "1-3": [0, 3] };
  for (const m of rows.filter((r) => r.round === 1)) {
    const [h, a] = scores[m.id.slice(1)] ?? [1, 0];
    play(m.id, { status: "finished", home_score: h, away_score: a });
  }
  const live = rows.find((r) => r.round === 2 && r.home_id && r.away_id);
  if (live) play(live.id, { status: "live", home_score: 1, away_score: 0 });

  return {
    tournament: {
      id: "demo-knockout",
      slug: "demo-knockout",
      name: "Campus FIFA Cup",
      format: "knockout",
      double_round: false,
      advance_per_group: null,
      status: "live",
      visibility: "public",
      starts_at: null,
      game: {
        id: "g-fifa",
        slug: "fifa",
        name: "FIFA",
        category: "esports",
        score_label: "Goals",
        allows_draws: true,
        pts_win: 3,
        pts_draw: 1,
        pts_loss: 0,
      },
    },
    participants,
    matches: rows,
  };
}

/**
 * Fake eight-team inter-faculty cup: two groups of four, every group match played, knockout not drawn yet.
 * Open the Manage tab and draw it to see the bracket appear.
 */
export function buildDemoGroupsBundle(): TournamentBundle {
  const names = ["Engineering", "Law", "Medicine", "Sciences", "Arts", "Education", "Social Sciences", "Pharmacy"];
  const split = assignGroups(names.map((_, i) => `p${i + 1}`), 2);
  const groupOf = new Map(split.flatMap((g) => g.ids.map((id) => [id, g.label] as const)));

  const participants: ParticipantRow[] = names.map((name, i) => ({
    id: `p${i + 1}`,
    tournament_id: "demo-groups",
    name,
    group_label: groupOf.get(`p${i + 1}`) ?? null,
    seed: i + 1,
  }));

  let seed = 11;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const goals = () => Math.floor(rnd() ** 1.6 * 4);

  const matches: MatchRow[] = generateGroupStage(split).fixtures.map((f, i) => ({
    id: `g${i + 1}`,
    tournament_id: "demo-groups",
    round: f.round,
    group_label: f.group,
    home_id: f.home,
    away_id: f.away,
    home_score: goals(),
    away_score: goals(),
    status: "finished",
    scheduled_at: null,
    next_match_id: null,
    next_slot: null,
  }));

  return {
    tournament: {
      id: "demo-groups",
      slug: "demo-groups",
      name: "Inter-Faculty Cup",
      format: "groups_knockout",
      double_round: false,
      advance_per_group: 2,
      status: "live",
      visibility: "public",
      starts_at: null,
      game: {
        id: "g-football",
        slug: "football",
        name: "Football",
        category: "sport",
        score_label: "Goals",
        allows_draws: true,
        pts_win: 3,
        pts_draw: 1,
        pts_loss: 0,
      },
    },
    participants,
    matches,
  };
}

/**
 * Fake finished tournaments for /rankings when Supabase is not connected: three football leagues that
 * share team names (so they merge into one all-time table) and a finished FIFA knockout.
 */
export function buildDemoRankingTournaments(): RankingTournament[] {
  const footballRules = { allowsDraws: true, ptsWin: 3, ptsDraw: 1, ptsLoss: 0 };
  const football = { slug: "football", name: "Football", category: "sport", ...footballRules };
  const fifa = { slug: "fifa", name: "FIFA", category: "esports", ...footballRules };
  const faculties = ["Computer Eng", "Mechanical", "Law Lions", "Medicine", "Arts Athletic", "Sciences"];

  const league = (id: string, name: string, seed0: number, order: string[]): RankingTournament => {
    let seed = seed0;
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const goals = () => Math.floor(rnd() ** 1.6 * 5);
    const participants = order.map((n, i) => ({ id: `${id}-p${i}`, name: n }));
    const { fixtures } = generateRoundRobin(participants.map((p) => p.id));
    return {
      id,
      slug: id,
      name,
      status: "finished",
      format: "round_robin",
      game: football,
      participants,
      matches: fixtures.map((f, i) => ({
        id: `${id}-m${i}`,
        round: f.round,
        group_label: null,
        home_id: f.home,
        away_id: f.away,
        home_score: goals(),
        away_score: goals(),
        status: "finished" as const,
        next_match_id: null,
        next_slot: null,
      })),
    };
  };

  const ko = buildDemoKnockoutBundle();
  let rows = ko.matches as (BracketRow & { group_label: string | null })[];
  for (const m of [...rows].sort((a, b) => a.round - b.round)) {
    const current = rows.find((r) => r.id === m.id);
    if (current && current.status !== "finished" && current.home_id && current.away_id) {
      rows = advanceKnockout(rows, current.id, { status: "finished", home_score: 2, away_score: 1 }).rows;
    }
  }
  for (const m of [...rows].sort((a, b) => a.round - b.round)) {
    const current = rows.find((r) => r.id === m.id);
    if (current && current.status !== "finished" && current.home_id && current.away_id) {
      rows = advanceKnockout(rows, current.id, { status: "finished", home_score: 3, away_score: 0 }).rows;
    }
  }

  return [
    {
      id: "demo-fifa",
      slug: "demo-knockout",
      name: ko.tournament.name,
      status: "finished",
      format: "knockout",
      game: fifa,
      participants: ko.participants.map((p) => ({ id: p.id, name: p.name })),
      matches: rows,
    },
    league("demo-2026", "Faculty Cup 2026", 7, faculties),
    league("demo-2025", "Faculty Cup 2025", 21, [...faculties].reverse().map((n) => n.toUpperCase() === "LAW LIONS" ? "law lions" : n)),
    league("demo-2024", "Faculty Cup 2024", 33, faculties),
  ];
}
