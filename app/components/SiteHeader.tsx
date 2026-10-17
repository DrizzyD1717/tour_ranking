"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase, hasSupabase, listMyInvites } from "@/lib/supabase";
import { useUser } from "@/lib/use-user";

export default function SiteHeader() {
  const { user, loading } = useUser();
  const userId = user?.id;
  const router = useRouter();
  const [name, setName] = useState<{ id: string; username: string } | null>(null);

  const loadName = useCallback(async () => {
    if (!hasSupabase || !userId) return;
    const { data } = await getSupabase().from("profiles").select("username").eq("id", userId).maybeSingle();
    if (data) setName({ id: userId, username: data.username as string });
  }, [userId]);

  useEffect(() => {
    void loadName();
    // The Account page announces a change so the header updates without a reload.
    window.addEventListener("profile-updated", loadName);
    return () => window.removeEventListener("profile-updated", loadName);
  }, [loadName]);

  const username = name && name.id === userId ? name.username : null;

  // Open link invitations, shown as a count on the Account link.
  const [invites, setInvites] = useState<{ id: string; count: number } | null>(null);
  const loadInvites = useCallback(async () => {
    if (!hasSupabase || !userId) return;
    try {
      const list = await listMyInvites();
      setInvites({ id: userId, count: list.length });
    } catch {
      /* the badge is a nicety; the Account page shows the real list and any error */
    }
  }, [userId]);
  useEffect(() => {
    void loadInvites();
    window.addEventListener("invites-updated", loadInvites);
    return () => window.removeEventListener("invites-updated", loadInvites);
  }, [loadInvites]);
  const inviteCount = invites && invites.id === userId ? invites.count : 0;

  async function signOut() {
    await getSupabase().auth.signOut();
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="font-display text-2xl font-extrabold tracking-tight">
          Matchday
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <Link href="/rankings" className="rounded-full px-3 py-2 text-muted transition-colors hover:text-foreground">
            Rankings
          </Link>
          {hasSupabase &&
            !loading &&
            (user ? (
              <>
                <Link
                  href="/my-tournaments"
                  className="hidden rounded-full px-3 py-2 text-muted transition-colors hover:text-foreground sm:block"
                >
                  My tournaments
                </Link>
                <Link
                  href="/account"
                  aria-label={inviteCount > 0 ? `Your account, ${inviteCount} open ${inviteCount === 1 ? "invitation" : "invitations"}` : "Your account"}
                  className="max-w-[9rem] truncate rounded-full px-3 py-2 text-muted transition-colors hover:text-foreground"
                >
                  <span className="sm:hidden">Account</span>
                  <span className="hidden sm:inline">{username ? `@${username}` : "Account"}</span>
                  {inviteCount > 0 && (
                    <span aria-hidden className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-xs font-bold text-primary-foreground">
                      {inviteCount}
                    </span>
                  )}
                </Link>
                <button
                  onClick={signOut}
                  className="hidden cursor-pointer rounded-full px-3 py-2 text-muted transition-colors hover:text-foreground sm:block"
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link href="/auth" className="rounded-full px-3 py-2 text-muted transition-colors hover:text-foreground">
                Sign in
              </Link>
            ))}
          <Link
            href="/tournaments/new"
            className="rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground transition hover:shadow-glow-lime"
          >
            <span className="sm:hidden">New</span>
            <span className="hidden sm:inline">Start a tournament</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
