import { redirect } from "next/navigation";
import { OnboardingForm } from "./onboarding-form";
import { getAuthorizedUser } from "@/lib/authorized-users";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export default async function OnboardingPage() {
  if (!isSupabaseConfigured()) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const identity = getAuthorizedUser(user.email);
  if (!identity) redirect("/login");

  const { data: membership } = await supabase
    .from("household_members")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (membership) redirect("/");

  return <OnboardingForm person={identity.person} name={identity.name} />;
}
