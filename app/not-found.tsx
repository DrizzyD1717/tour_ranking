import Link from "next/link";

export default function NotFound() {
  return (
    <main className="bg-floodlight">
      <div className="mx-auto flex min-h-[60dvh] max-w-5xl flex-col items-start justify-center gap-5 px-4 py-20 sm:px-6">
        <p className="font-display text-xl font-bold uppercase tracking-widest text-primary">Offside</p>
        <h1 className="font-display text-7xl font-extrabold leading-[0.9] tracking-tight sm:text-9xl">404</h1>
        <p className="max-w-md text-muted">
          That page isn&apos;t on the pitch. The link may be wrong, or the tournament was deleted or made private.
        </p>
        <Link
          href="/"
          className="rounded-full bg-primary px-5 py-2.5 font-semibold text-primary-foreground transition-shadow hover:shadow-glow-lime"
        >
          Back to tournaments
        </Link>
      </div>
    </main>
  );
}
