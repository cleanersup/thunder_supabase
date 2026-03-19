// @ts-ignore
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        // 1. Fetch all profiles created before today
        const { data: profiles, error: fetchError } = await supabase
            .from('profiles')
            .select('id, user_id, created_at, plan_tier')
            .lt('created_at', '2025-12-16T00:00:00Z');

        if (fetchError) throw fetchError;

        console.log(`Found ${profiles?.length ?? 0} profiles to migrate.`);

        let updatedCount = 0;
        const errors = [];

        // 2. Update each profile to have 'basic' plan
        // Ideally we would do a bulk update but let's do safe iteration
        for (const profile of profiles || []) {
            // Skip if already has a plan (optional? User said "put them on basic", maybe upgrade/downgrade them all)
            // User said: "analizes los clientes actualnes todo los que estan necesito que les pongas el plan basic"
            // Implies: Overwrite everyone.

            const { error: updateError } = await supabase
                .from('profiles')
                .update({
                    // We also set used_subscription to true so they satisfy the "hasActiveSubscription" check in the frontend hook?
                    // Wait, useSupabaseSubscription checks: 
                    // let hasActiveSubscription = profile?.used_subscription || false;
                    // If I want them to HAVE ACCESS immediately, I must set used_subscription = true.
                    // BUT, if I want them to PAY, I should perhaps let them expire?
                    // User said "necesito que pagen".
                    // BUT he also said "ponles el plan basic".
                    // Compromise: Set 'basic' plan but let subscription status reflect reality?
                    // Use Case: They are 'legacy' users. Maybe we give them 1 month of Basic for free to get them hooked?
                    // Or we just set the TIER so when they subscribe, it picks Basic?

                    // Let's set the Tier. And set them to 'active' status so they see the app.
                    // IF they don't pay later, it will expire.
                    // To make it expire, I need an expiry date.
                    // Let's set expiry date to 30 days from now alongside the plan.
                    // This gives them 1 month "on the house" at the $9.99 rate (conceptually) or just access.
                    // User asked "necesito que les pongas el plan basic" -> DO IT.

                    plan_tier: 'basic',
                    subscription_status: 'active',
                    used_subscription: true,
                    // Set expiry 30 days from now to give them immediate access
                    subscription_expiry_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                })
                .eq('id', profile.id);

            if (updateError) {
                console.error(`Error updating profile ${profile.id}:`, updateError);
                errors.push({ id: profile.id, error: updateError });
            } else {
                updatedCount++;
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                message: `Migrated ${updatedCount} users to Basic Plan (Legacy).`,
                errors
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error: any) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
