import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminServerEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

export function createAdminSupabaseClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseAdminServerEnv();
  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
