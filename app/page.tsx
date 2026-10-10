import Link from "next/link";

// Placeholder home page. The real one (live tournaments, rankings by game) is a later slice.
export default function Home() {
  return (
    <main className="bg-floodlight min-h-[calc(100dvh-3.5rem)] px-6 py-20 sm:px-10">
      <div className="max-w-xl">
        <h1 className="font-display text-6xl font-extrabold leading-[0.95] tracking-tight sm:text-8xl">Matchday</h1>
        <p className="mt-5 max-w-md text-lg text-muted">
          Start a tournament, enter the scores, and everyone follows the table.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/tournaments/new"
            className="inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:shadow-glow-lime"
          >
            Start a tournament
          </Link>
          <Link
            href="/tournaments/demo"
            className="inline-flex rounded-full border border-border-strong px-6 py-3 font-semibold transition hover:border-foreground"
          >
            See a demo
          </Link>
        </div>
      </div>
    </main>
  );
}
