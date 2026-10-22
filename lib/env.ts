import { z } from "zod";

const publicServerEnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
});

const adminServerEnvSchema = publicServerEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const googleServerEnvSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.url().refine((value) => {
    const parsed = new URL(value);
    return parsed.pathname === "/api/auth/google/callback" && (parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  }),
  TOKEN_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
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

export function getGoogleServerEnv(env: ServerEnv = process.env) {
  const result = googleServerEnvSchema.safeParse({
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: env.GOOGLE_REDIRECT_URI,
    TOKEN_ENCRYPTION_KEY: env.TOKEN_ENCRYPTION_KEY,
  });
  if (!result.success) throw new Error("Google OAuth server configuration is missing or invalid.");
  return result.data;
}
