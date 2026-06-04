import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Reply-To for client-facing emails: business owner's company email, then auth email.
 * Same resolution order as send-invoice-email / send-estimate-email.
 */
export async function resolveOwnerReplyEmail(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_email")
    .eq("user_id", userId)
    .maybeSingle();

  const companyEmail = (profile?.company_email ?? "").trim();
  if (companyEmail) return companyEmail;

  const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(userId);
  if (authErr || !authUser?.user?.email) {
    throw new Error("Could not resolve business owner email");
  }

  return authUser.user.email.trim();
}
