import { cache, Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildDemoBundle, buildDemoGroupsBundle, buildDemoKnockoutBundle } from "@/lib/demo";
import { getTournamentBundle, hasSupabase } from "@/lib/supabase";
import TournamentView from "./TournamentView";

// With cacheComponents on, pages are dynamic by default (no `export const dynamic` needed, and it is
// not allowed). Anything fetched at request time must sit inside a <Suspense> boundary, so the page
// is a thin shell and the data loading happens in <Tournament /> below.

const load = cache(async (slug: string) => {
  if (slug === "demo") return buildDemoBundle();
  if (slug === "demo-knockout") return buildDemoKnockoutBundle();
  if (slug === "demo-groups") return buildDemoGroupsBundle();
  if (!hasSupabase) return null;
  return getTournamentBundle(slug);
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await load(slug);
  return { title: bundle ? bundle.tournament.name : "Tournament not found" };
}

export default function TournamentPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<TournamentSkeleton />}>
      <Tournament params={params} />
    </Suspense>
  );
}

async function Tournament({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await load(slug);
  if (!bundle) notFound();
  return <TournamentView initial={bundle} demo={slug === "demo" || slug === "demo-knockout" || slug === "demo-groups"} />;
}

function TournamentSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading tournament">
      <div className="bg-floodlight border-b border-border">
        <div className="mx-auto max-w-5xl space-y-5 px-4 pb-10 pt-16 sm:px-6">
          <div className="skeleton h-7 w-28 rounded-full" />
          <div className="skeleton h-20 w-3/4 max-w-xl rounded-2xl" />
          <div className="skeleton h-4 w-64 rounded" />
        </div>
      </div>
      <div className="mx-auto max-w-5xl space-y-3 px-4 py-8 sm:px-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-16 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
