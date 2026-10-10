"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase, hasSupabase } from "@/lib/supabase";

const INPUT =
  "w-full rounded-xl border border-border bg-surface-sunken px-4 py-3 outline-none transition placeholder:text-subtle focus:border-primary";

function friendly(message: string) {
  if (/invalid login credentials/i.test(message)) return "That email and password don't match an account.";
  if (/already registered/i.test(message)) return "An account with this email already exists. Sign in instead.";
  return message;
}

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ?next=/some/path sends people back to where they were headed. Only same-site paths are allowed.
  function destination() {
    const next = new URLSearchParams(window.location.search).get("next");
    return next && next.startsWith("/") && !next.startsWith("//") ? next : "/tournaments/new";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const sb = getSupabase();

    if (mode === "signin") {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setError(friendly(error.message));
        setBusy(false);
        return;
      }
      router.push(destination());
      return;
    }

    const { data, error } = await sb.auth.signUp({ email: email.trim(), password });
    if (error) {
      setError(friendly(error.message));
      setBusy(false);
      return;
    }
    if (data.session) {
      router.push(destination());
    } else {
      setNotice("Account created. Open the confirmation email we sent, then come back and sign in.");
      setMode("signin");
      setBusy(false);
    }
  }

  const signingIn = mode === "signin";

  return (
    <main className="bg-floodlight min-h-[calc(100dvh-3.5rem)] px-4 py-12 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-md">
        <h1 className="font-display text-6xl font-extrabold leading-[0.95] tracking-tight">
          {signingIn ? "Sign in" : "Create your account"}
        </h1>
        <p className="mt-4 text-muted">
          {signingIn
            ? "Sign in to start tournaments and enter scores."
            : "An account lets you start tournaments and enter scores. Following a tournament never needs one."}
        </p>

        {!hasSupabase ? (
          <p className="mt-8 rounded-2xl border border-dashed border-border-strong px-5 py-6 text-muted">
            Supabase isn&apos;t connected yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to
            .env.local, then restart the dev server.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-5">
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={INPUT}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete={signingIn ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={INPUT}
                placeholder="At least 6 characters"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-xl border border-loss/40 bg-loss/10 px-4 py-3 text-sm text-loss">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="rounded-xl border border-win/40 bg-win/10 px-4 py-3 text-sm text-win">
                {notice}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full cursor-pointer rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:shadow-glow-lime disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? (signingIn ? "Signing in..." : "Creating account...") : signingIn ? "Sign in" : "Create account"}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode(signingIn ? "signup" : "signin");
                setError(null);
                setNotice(null);
              }}
              className="cursor-pointer text-sm text-muted underline-offset-4 hover:text-foreground hover:underline"
            >
              {signingIn ? "New here? Create an account" : "Already have an account? Sign in"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
