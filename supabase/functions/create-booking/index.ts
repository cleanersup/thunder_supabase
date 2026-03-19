import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      business_owner_id,
      lead_name,
      email,
      phone,
      service_type,
      street,
      apt_suite,
      city,
      state,
      zip_code,
      preferred_date,
      time_preference,
      bedrooms,
      bathrooms,
      additional_services,
      commercial_property_type,
      other_commercial_type,
      service_details,
      custom_answers,
      status = 'new'
    } = body;

    if (!business_owner_id || !lead_name || !email || !phone || !street || !city || !state || !zip_code || !service_type) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data, error } = await supabase
      .from('bookings')
      .insert({
        business_owner_id,
        lead_name,
        email,
        phone,
        service_type: service_type.toLowerCase(),
        street,
        apt_suite: apt_suite || null,
        city,
        state,
        zip_code,
        preferred_date: preferred_date || null,
        time_preference: time_preference || null,
        bedrooms: bedrooms ? parseInt(bedrooms) : null,
        bathrooms: bathrooms ? parseInt(bathrooms) : null,
        additional_services: additional_services || [],
        commercial_property_type: commercial_property_type || null,
        other_commercial_type: other_commercial_type || null,
        service_details: service_details || null,
        custom_answers: custom_answers || {},
        status
      })
      .select()
      .single();

    if (error) {
      console.error('create-booking error:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('create-booking exception:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
