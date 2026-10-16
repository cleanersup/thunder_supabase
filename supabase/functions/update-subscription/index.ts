import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// Disabled: it upserted profiles.plan_tier with the service role for whatever
// userId arrived in the body, with no caller check. Plan changes come from the
// revenuecat-webhook function.

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve((req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders })
    }

    return new Response(JSON.stringify({ error: 'This endpoint is no longer available' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 410,
    })
})
