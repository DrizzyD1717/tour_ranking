import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { hasSupabase, listPublicTournaments } from "@/lib/supabase";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const pages: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/rankings`, changeFrequency: "daily", priority: 0.8 },
  ];
  if (!hasSupabase) return pages;
  try {
    const list = await listPublicTournaments(500);
    return [
      ...pages,
      ...list.map((t) => ({
        url: `${base}/tournaments/${t.slug}`,
        lastModified: t.finishedAt ?? t.createdAt,
        changeFrequency: (t.status === "finished" ? "monthly" : "hourly") as "monthly" | "hourly",
        priority: t.status === "finished" ? 0.4 : 0.7,
      })),
    ];
  } catch {
    return pages;
  }
}
