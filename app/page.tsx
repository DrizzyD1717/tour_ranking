import Link from "next/link";

// Placeholder home page. The real one (live tournaments, rankings by game) is a later slice.
export default function Home() {
  return (
    <main className="bg-floodlight grid min-h-dvh place-items-start px-6 py-20 sm:px-10">
      <div className="max-w-xl">
        <h1 className="font-display text-6xl font-extrabold leading-[0.95] tracking-tight sm:text-8xl">Matchday</h1>
        <p className="mt-5 max-w-md text-lg text-muted">
          Start a tournament, enter the scores, and everyone follows the table.
        </p>
        <Link
          href="/tournaments/demo"
          className="mt-8 inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:shadow-glow-lime"
        >
          See a demo tournament
        </Link>
      </div>
    </main>
  );
}
