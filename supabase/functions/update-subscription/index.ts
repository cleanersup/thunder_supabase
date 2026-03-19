import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders })
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const { userId, hasPremium, planTier, subscriptionStatus, expiryDate } = await req.json()

        console.log(`Updating subscription for user ${userId}:`, { hasPremium, planTier })

        if (!userId) {
            throw new Error('User ID is required')
        }

        // Prepare updates
        const updates: any = {
            id: userId,
            used_subscription: hasPremium,
            updated_at: new Date().toISOString(),
        }

        // Add optional fields if provided
        if (planTier !== undefined) updates.plan_tier = planTier
        if (subscriptionStatus !== undefined) updates.subscription_status = subscriptionStatus
        if (expiryDate !== undefined) updates.subscription_expiry = expiryDate

        // Perform upsert with admin privileges
        const { data, error } = await supabaseClient
            .from('profiles')
            .upsert(updates)
            .select()

        if (error) {
            console.error('Error updating profile:', error)
            throw error
        }

        console.log('Profile updated successfully:', data)

        return new Response(JSON.stringify({ success: true, data }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })
    } catch (error) {
        console.error('Error:', error)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
