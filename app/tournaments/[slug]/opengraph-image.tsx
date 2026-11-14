import { ImageResponse } from "next/og";
import { connection } from "next/server";
import { buildDemoBundle, buildDemoGroupsBundle, buildDemoKnockoutBundle } from "@/lib/demo";
import { getTournamentBundle, hasSupabase, type TournamentBundle } from "@/lib/supabase";
import { championOf } from "@/lib/tournament";

export const alt = "Tournament on Matchday";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const FORMAT = { round_robin: "League", knockout: "Knockout", groups_knockout: "Groups + knockout" } as const;

async function load(slug: string): Promise<TournamentBundle | null> {
  if (slug === "demo") return buildDemoBundle();
  if (slug === "demo-knockout") return buildDemoKnockoutBundle();
  if (slug === "demo-groups") return buildDemoGroupsBundle();
  if (!hasSupabase) return null;
  try {
    return await getTournamentBundle(slug);
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const b = await load(slug);
  // Private tournaments are invisible to the anonymous server read, so they get the plain brand card.
  const t = b && b.tournament.visibility !== "private" ? b.tournament : null;

  let line = "Run tournaments and follow the table";
  let tag = "";
  if (b && t) {
    const played = b.matches.filter((m) => m.status === "finished").length;
    const champ = championOf({
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      format: t.format,
      game: { slug: t.game.slug, name: t.game.name, category: t.game.category, allowsDraws: t.game.allows_draws, ptsWin: t.game.pts_win, ptsDraw: t.game.pts_draw, ptsLoss: t.game.pts_loss },
      participants: b.participants,
      matches: b.matches,
    });
    const name = champ ? b.participants.find((p) => p.id === champ)?.name : null;
    line = name ? `Champion: ${name}` : t.status === "finished" ? "Finished" : `${played} of ${b.matches.length} matches played`;
    tag = `${t.game.name} · ${FORMAT[t.format]} · ${b.participants.length} ${b.participants.length === 1 ? "entrant" : "entrants"}`;
  }

  const title = t?.name ?? "Matchday";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(160deg, #0b1410 0%, #10231a 100%)",
          color: "#f2f7f3",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: 6, color: "#c8f542" }}>MATCHDAY</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: title.length > 28 ? 80 : 108, fontWeight: 800, lineHeight: 1.02 }}>{title}</div>
          {tag ? <div style={{ display: "flex", marginTop: 24, fontSize: 36, color: "#9db3a5" }}>{tag}</div> : null}
        </div>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: t?.status === "finished" ? "#f5c451" : "#c8f542" }}>{line}</div>
      </div>
    ),
    { ...size },
  );
}
