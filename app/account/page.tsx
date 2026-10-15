"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase, hasSupabase } from "@/lib/supabase";
import { useUser } from "@/lib/use-user";

const USERNAME = /^[a-z0-9_]{3,20}$/;
const INPUT =
  "w-full rounded-xl border border-border bg-surface-sunken px-4 py-3 outline-none transition placeholder:text-subtle focus:border-primary";

export default function AccountPage() {
  const router = useRouter();
  const { user, loading } = useUser();
  const userId = user?.id;

  const [saved, setSaved] = useState<string | null>(null); // what is stored right now
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!hasSupabase || !userId) return;
    let active = true;
    getSupabase()
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        setSaved(data.username as string);
        setUsername(data.username as string);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    setError(null);
    setDone(false);
    if (!USERNAME.test(username)) {
      setError("Use 3 to 20 characters: lowercase letters, numbers or underscores. No spaces.");
      return;
    }
    setBusy(true);
    const { data, error } = await getSupabase().from("profiles").update({ username }).eq("id", userId).select("username");
    setBusy(false);
    if (error) {
      setError(
        error.code === "23505"
          ? "That username is taken. Try another."
          : error.code === "23514"
            ? "Use 3 to 20 characters: lowercase letters, numbers or underscores. No spaces."
            : error.message,
      );
      return;
    }
    if (!data || data.length === 0) {
      setError("Couldn't save. Sign out, sign in again, and retry.");
      return;
    }
    setSaved(username);
    setDone(true);
    window.dispatchEvent(new Event("profile-updated"));
  }

  async function signOut() {
    await getSupabase().auth.signOut();
    router.push("/");
  }

  const shell = (children: React.ReactNode) => (
    <main className="bg-floodlight min-h-[calc(100dvh-3.5rem)] px-4 py-12 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-md">
        <h1 className="font-display text-6xl font-extrabold leading-[0.95] tracking-tight">Your account</h1>
        {children}
      </div>
    </main>
  );

  if (!hasSupabase) {
    return shell(
      <p className="mt-8 rounded-2xl border border-dashed border-border-strong px-5 py-6 text-muted">
        Supabase isn&apos;t connected yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local,
        then restart the dev server.
      </p>,
    );
  }

  if (loading) {
    return shell(<div className="skeleton mt-8 h-40 rounded-2xl" aria-busy="true" aria-label="Loading" />);
  }

  if (!user) {
    return shell(
      <div className="mt-8 rounded-2xl border border-border bg-surface p-6">
        <p className="text-lg font-medium">Sign in to see your account.</p>
        <Link
          href="/auth?next=/account"
          className="mt-5 inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:shadow-glow-lime"
        >
          Sign in
        </Link>
      </div>,
    );
  }

  return shell(
    <form onSubmit={save} className="mt-8 space-y-5">
      <div>
        <label htmlFor="username" className="mb-2 block font-medium">
          Username
        </label>
        <input
          id="username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value.toLowerCase());
            setDone(false);
          }}
          maxLength={20}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className={INPUT}
          aria-describedby="username-help"
        />
        <p id="username-help" className="mt-2 text-sm text-subtle">
          Organizers use this to add you as a scorekeeper, and it shows on tournaments you help run. It is separate from
          your email, which stays private.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-loss/40 bg-loss/10 px-4 py-3 text-sm text-loss">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-xl border border-win/40 bg-win/10 px-4 py-3 text-sm text-win">
          Saved. You are now @{saved}.
        </p>
      )}

      <button
        type="submit"
        disabled={busy || saved === null || username === saved}
        className="w-full cursor-pointer rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:shadow-glow-lime disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        {busy ? "Saving..." : "Save username"}
      </button>

      <Link href="/my-tournaments" className="block text-sm font-medium text-primary underline-offset-4 hover:underline">
        My tournaments
      </Link>

      <div className="flex items-center justify-between gap-4 border-t border-border pt-5 text-sm text-muted">
        <span className="min-w-0 truncate">Signed in as {user.email}</span>
        <button type="button" onClick={signOut} className="shrink-0 cursor-pointer underline-offset-4 hover:text-foreground hover:underline">
          Sign out
        </button>
      </div>
    </form>,
  );
}
