import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types (mirror supabase/schema.sql; replace with generated types later if you like)
// ---------------------------------------------------------------------------

export interface Game {
  id: string;
  slug: string;
  name: string;
  category: "esports" | "sport";
  score_label: string;
  allows_draws: boolean;
  pts_win: number;
  pts_draw: number;
  pts_loss: number;
}

export interface Tournament {
  id: string;
  slug: string;
  name: string;
  format: "round_robin" | "knockout" | "groups_knockout";
  double_round: boolean;
  status: "draft" | "live" | "finished";
  visibility: "public" | "unlisted" | "private";
  starts_at: string | null;
  game: Game;
}

export interface ParticipantRow {
  id: string;
  tournament_id: string;
  name: string;
  group_label: string | null;
  seed: number | null;
}

export interface MatchRow {
  id: string;
  tournament_id: string;
  round: number;
  group_label: string | null;
  home_id: string | null;
  away_id: string | null;
  home_score: number | null;
  away_score: number | null;
  status: "scheduled" | "live" | "finished";
  scheduled_at: string | null;
}

export interface TournamentBundle {
  tournament: Tournament;
  participants: ParticipantRow[];
  matches: MatchRow[];
}

// ---------------------------------------------------------------------------
// Client (works on the server and in the browser; public reads need no cookies yet.
// When login arrives, switch to @supabase/ssr so the session travels in cookies.)
// ---------------------------------------------------------------------------

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hasSupabase = Boolean(url && key);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
  }
  // In the browser the session is kept in storage so people stay signed in. On the server there is no
  // session (public pages read as an anonymous visitor), so nothing is persisted or refreshed there.
  const inBrowser = typeof window !== "undefined";
  return (client ??= createClient(url, key, { auth: { persistSession: inBrowser, autoRefreshToken: inBrowser } }));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getTournamentBundle(slug: string): Promise<TournamentBundle | null> {
  const sb = getSupabase();

  const { data: tournament, error } = await sb
    .from("tournaments")
    .select(
      "id, slug, name, format, double_round, status, visibility, starts_at, game:games(id, slug, name, category, score_label, allows_draws, pts_win, pts_draw, pts_loss)",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`Could not load tournament: ${error.message}`);
  if (!tournament) return null;

  const [participants, matches] = await Promise.all([
    sb.from("participants").select("id, tournament_id, name, group_label, seed").eq("tournament_id", tournament.id).order("seed", { nullsFirst: false }),
    sb
      .from("matches")
      .select("id, tournament_id, round, group_label, home_id, away_id, home_score, away_score, status, scheduled_at")
      .eq("tournament_id", tournament.id)
      .order("round")
      .order("scheduled_at", { nullsFirst: false }),
  ]);

  if (participants.error) throw new Error(`Could not load participants: ${participants.error.message}`);
  if (matches.error) throw new Error(`Could not load matches: ${matches.error.message}`);

  return {
    tournament: tournament as unknown as Tournament,
    participants: (participants.data ?? []) as ParticipantRow[],
    matches: (matches.data ?? []) as MatchRow[],
  };
}

// ---------------------------------------------------------------------------
// Home page list
// ---------------------------------------------------------------------------

export interface TournamentSummary {
  id: string;
  slug: string;
  name: string;
  status: Tournament["status"];
  format: Tournament["format"];
  createdAt: string;
  game: { name: string; slug: string; category: Game["category"] };
  /** Teams or players entered. */
  entrants: number;
  played: number;
  total: number;
}

interface SummaryRow {
  id: string;
  slug: string;
  name: string;
  status: Tournament["status"];
  format: Tournament["format"];
  created_at: string;
  game: { name: string; slug: string; category: Game["category"] } | null;
  participants: { count: number }[] | null;
  matches: { status: MatchRow["status"] }[] | null;
}

/** Turns the raw database rows into what the home page shows. Live tournaments come first, then newest. */
export function summarizeTournaments(rows: SummaryRow[]): TournamentSummary[] {
  return rows
    .filter((r) => r.game)
    .map((r) => {
      const matches = r.matches ?? [];
      return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        status: r.status,
        format: r.format,
        createdAt: r.created_at,
        game: r.game as TournamentSummary["game"],
        entrants: r.participants?.[0]?.count ?? 0,
        played: matches.filter((m) => m.status === "finished").length,
        total: matches.length,
      };
    })
    .sort((a, b) => {
      const live = Number(b.status === "live") - Number(a.status === "live");
      return live !== 0 ? live : b.createdAt.localeCompare(a.createdAt);
    });
}

/** Public tournaments only. Link-only and private ones are never listed. */
export async function listPublicTournaments(limit = 30): Promise<TournamentSummary[]> {
  const { data, error } = await getSupabase()
    .from("tournaments")
    .select(
      "id, slug, name, status, format, created_at, game:games(name, slug, category), participants(count), matches(status)",
    )
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return summarizeTournaments((data ?? []) as unknown as SummaryRow[]);
}
