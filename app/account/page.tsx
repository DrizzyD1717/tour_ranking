"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buildRankings, recordFor, type PersonalRecord } from "@/lib/tournament";
import { getSupabase, hasSupabase, listMyInvites, listMyLinks, listRankingTournaments, respondToInvite, unlinkMe, type LinkInvite } from "@/lib/supabase";
import { useUser } from "@/lib/use-user";

const USERNAME = /^[a-z0-9_]{3,20}$/;
const INPUT =
  "w-full rounded-xl border border-border bg-surface-sunken px-4 py-3 outline-none transition placeholder:text-subtle focus:border-primary";

/** Organizers who add you as @username send an invitation. Only accepted ones count towards your record. */
function Invitations({ userId }: { userId: string }) {
  const [state, setState] = useState<{ id: string; list: LinkInvite[] | null; error: string | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState({ id: userId, list: await listMyInvites(), error: null });
    } catch (e) {
      setState({ id: userId, list: null, error: e instanceof Error ? e.message : "Unknown error" });
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function answer(invite: LinkInvite, accept: boolean) {
    setBusyId(invite.participantId);
    setMessage(null);
    const error = await respondToInvite(invite.participantId, accept);
    setBusyId(null);
    setMessage(error ?? (accept ? `Accepted. ${invite.tournamentName} now counts towards your record.` : "Declined."));
    await load();
    window.dispatchEvent(new Event("invites-updated"));
    if (!error && accept) window.dispatchEvent(new Event("record-updated"));
  }

  const mine = state && state.id === userId ? state : null;
  if (!mine || (mine.list?.length === 0 && !message && !mine.error)) return null;

  return (
    <section aria-labelledby="inv-h" className="border-t border-border pt-5">
      <h2 id="inv-h" className="font-display text-3xl font-bold">
        Invitations
      </h2>
      {mine.error && (
        <p role="alert" className="mt-2 text-sm text-loss">
          Couldn&apos;t load your invitations: {mine.error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-2 text-sm text-muted">
          {message}
        </p>
      )}
      <ul className="mt-3 space-y-3">
        {(mine.list ?? []).map((inv) => (
          <li key={inv.participantId} className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
            <p className="font-medium">
              {inv.organizer ? `@${inv.organizer}` : "An organizer"} added you to{" "}
              <span className="font-display text-xl font-bold">{inv.tournamentName}</span>
              {inv.visibility === "private" && <span className="text-subtle"> (private)</span>}
            </p>
            <p className="mt-1 text-sm text-muted">
              Accept to have its results count in your record and the rankings. Decline and it stays a plain name.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => answer(inv, true)}
                className="cursor-pointer rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:shadow-glow-lime disabled:cursor-not-allowed disabled:opacity-40"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => answer(inv, false)}
                className="cursor-pointer rounded-full border border-border-strong px-4 py-2 text-sm font-medium transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Tournaments you accepted a link to. Unlinking turns your entry back into a plain name. */
function LinkedTournaments({ userId }: { userId: string }) {
  const [state, setState] = useState<{ id: string; list: LinkInvite[] | null; error: string | null } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState({ id: userId, list: await listMyLinks(), error: null });
    } catch (e) {
      setState({ id: userId, list: null, error: e instanceof Error ? e.message : "Unknown error" });
    }
  }, [userId]);

  useEffect(() => {
    void load();
    // Accepting an invitation adds a row here without a reload.
    window.addEventListener("record-updated", load);
    return () => window.removeEventListener("record-updated", load);
  }, [load]);

  async function unlink(link: LinkInvite) {
    setBusy(true);
    setMessage(null);
    const error = await unlinkMe(link.participantId);
    setBusy(false);
    setConfirming(null);
    setMessage(error ?? `Unlinked from ${link.tournamentName}. It no longer counts towards your record.`);
    await load();
    if (!error) window.dispatchEvent(new Event("record-updated"));
  }

  const mine = state && state.id === userId ? state : null;
  if (!mine || (mine.list?.length === 0 && !message && !mine.error)) return null;

  return (
    <section aria-labelledby="links-h" className="border-t border-border pt-5">
      <h2 id="links-h" className="font-display text-3xl font-bold">
        Linked tournaments
      </h2>
      {mine.error && (
        <p role="alert" className="mt-2 text-sm text-loss">
          Couldn&apos;t load your linked tournaments: {mine.error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-2 text-sm text-muted">
          {message}
        </p>
      )}
      <ul className="mt-3 space-y-3">
        {(mine.list ?? []).map((link) => (
          <li key={link.participantId} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate font-medium">
                {link.tournamentName}
                {link.visibility === "private" && <span className="text-subtle"> (private)</span>}
              </p>
              {confirming !== link.participantId && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirming(link.participantId)}
                  aria-label={`Unlink me from ${link.tournamentName}`}
                  className="shrink-0 cursor-pointer rounded-full border border-border-strong px-4 py-2 text-sm font-medium transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Unlink
                </button>
              )}
            </div>
            {confirming === link.participantId && (
              <div role="alertdialog" aria-label={`Confirm unlinking from ${link.tournamentName}`} className="mt-3 rounded-xl border border-loss/40 bg-loss/10 p-3">
                <p className="text-sm">
                  Your results here will stop counting for you, and the organizer can&apos;t link you again unless you
                  are removed and re-added. Your name stays in the tournament as plain text.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => unlink(link)}
                    className="cursor-pointer rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:shadow-glow-lime disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Unlink me
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirming(null)}
                    className="cursor-pointer rounded-full border border-border-strong px-4 py-2 text-sm font-medium transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Titles, record and rank in every game this account has played in public tournaments. */
function YourRecord({ userId }: { userId: string }) {
  const [result, setResult] = useState<{ id: string; records: PersonalRecord[] | null } | null>(null);

  const [reload, setReload] = useState(0);
  useEffect(() => {
    const again = () => setReload((n) => n + 1);
    window.addEventListener("record-updated", again);
    return () => window.removeEventListener("record-updated", again);
  }, []);

  useEffect(() => {
    let active = true;
    listRankingTournaments()
      .then((ts) => active && setResult({ id: userId, records: recordFor(buildRankings(ts).games, userId) }))
      .catch(() => active && setResult({ id: userId, records: null }));
    return () => {
      active = false;
    };
  }, [userId, reload]);

  const mine = result && result.id === userId ? result : null;
  return (
    <section aria-labelledby="record-h" className="border-t border-border pt-5">
      <h2 id="record-h" className="font-display text-3xl font-bold">
        Your record
      </h2>
      {!mine ? (
        <div className="skeleton mt-3 h-20 rounded-2xl" aria-busy="true" aria-label="Loading your record" />
      ) : mine.records === null ? (
        <p className="mt-2 text-sm text-muted">Couldn&apos;t load your record right now.</p>
      ) : mine.records.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Nothing yet. When an organizer adds you as <span className="font-medium text-foreground">@your-username</span> to
          a public tournament, your results show up here and in the rankings.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {mine.records.map((r) => (
            <li key={r.game.slug} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display text-2xl font-bold">{r.game.name}</span>
                <span className="text-sm text-muted">
                  #{r.rank} of {r.of}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">
                <span className="font-medium text-foreground">
                  {r.row.titles} {r.row.titles === 1 ? "title" : "titles"}
                </span>
                {" · "}
                {r.row.won}W {r.row.drawn}D {r.row.lost}L{" · "}
                {Math.round(r.row.winRate * 100)}% wins
                {" · "}
                {r.row.tournaments} {r.row.tournaments === 1 ? "tournament" : "tournaments"}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Link href="/rankings" className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
        See the full rankings
      </Link>
    </section>
  );
}

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
    <>
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
    </form>
    <div className="mt-8 space-y-8">
      <Invitations userId={user.id} />
      <YourRecord userId={user.id} />
      <LinkedTournaments userId={user.id} />
    </div>
    </>,
  );
}
