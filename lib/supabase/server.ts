import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicServerEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

export async function createUserSupabaseClient() {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = getSupabasePublicServerEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot set cookies. Session refresh is handled by a later auth middleware.
        }
      },
    },
  });
}
