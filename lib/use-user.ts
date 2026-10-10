"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase, hasSupabase } from "./supabase";

/** The signed-in user (or null) plus whether we are still finding out. Browser only. */
export function useUser() {
  const [state, setState] = useState<{ user: User | null; loading: boolean }>({ user: null, loading: hasSupabase });

  useEffect(() => {
    if (!hasSupabase) return;
    const sb = getSupabase();
    let active = true;

    sb.auth.getSession().then(({ data }) => {
      if (active) setState({ user: data.session?.user ?? null, loading: false });
    });
    const { data } = sb.auth.onAuthStateChange((_event, session) => {
      setState({ user: session?.user ?? null, loading: false });
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return state;
}
