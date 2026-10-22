"use server";

import { z } from "zod";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const credentialsSchema = z.object({
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(1),
});

export async function signInAction(formData: FormData) {
  const credentials = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!credentials.success) redirect("/login?error=1");

  const supabase = await createUserSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword(credentials.data);
  if (error) redirect("/login?error=1");
  redirect("/");
}

export async function signOutAction() {
  const supabase = await createUserSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}
