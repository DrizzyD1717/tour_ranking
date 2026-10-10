import { generateRoundRobin } from "./tournament";
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
    };
  });

  return {
    tournament: {
      id: "demo",
      slug: "demo",
      name: "Faculty Cup",
      format: "round_robin",
      double_round: false,
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
