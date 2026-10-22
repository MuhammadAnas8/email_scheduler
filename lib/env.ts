import { z } from "zod";

const publicServerEnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
});

const adminServerEnvSchema = publicServerEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export function getSupabasePublicServerEnv() {
  const result = publicServerEnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error("Supabase server configuration is missing or invalid.");
  }
  return result.data;
}

export function getSupabaseAdminServerEnv() {
  const result = adminServerEnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error("Supabase admin server configuration is missing or invalid.");
  }
  return result.data;
}
