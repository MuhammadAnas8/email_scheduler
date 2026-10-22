import { z } from "zod";

const publicServerEnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
});

const adminServerEnvSchema = publicServerEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

type ServerEnv = Record<string, string | undefined>;

export function getSupabasePublicServerEnv(env: ServerEnv = process.env) {
  const result = publicServerEnvSchema.safeParse({
    SUPABASE_URL: env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!result.success) {
    throw new Error("Supabase server configuration is missing or invalid.");
  }
  return result.data;
}

export function getSupabaseAdminServerEnv(env: ServerEnv = process.env) {
  const publicEnv = getSupabasePublicServerEnv(env);
  const result = adminServerEnvSchema.safeParse({
    ...publicEnv,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY,
  });
  if (!result.success) {
    throw new Error("Supabase admin server configuration is missing or invalid.");
  }
  return result.data;
}
