import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import * as Sentry from "npm:@sentry/deno";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Sentry.init({
    dsn: "https://ce035a76b6157a602d88c53eab6570e4@o4509804047958016.ingest.us.sentry.io/4510552540971008",
    environment: Deno.env.get("SUPABASE_URL")?.includes("staging") ? "staging" : "production",
    tracesSampleRate: 0.1,
});

interface WalkthroughCompletionSMSRequest {
    walkthroughId: string;
}

// Normalize phone number: add +1 prefix if not present
const normalizePhoneNumber = (phone: string): string => {
    const cleaned = phone.replace(/[^\d+]/g, '');

    if (cleaned.startsWith('+1')) {
        return cleaned;
    }

    const digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
    return `+1${digits}`;
};

serve(async (req) => {
    return await Sentry.withScope(async (scope) => {
        Sentry.setTag("function", "send-walkthrough-completion-sms");

        if (req.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        console.log("=== send-walkthrough-completion-sms FUNCTION TRIGGERED ===");
        console.log("Timestamp:", new Date().toISOString());

        try {
            const body = await req.json();
            const { walkthroughId }: WalkthroughCompletionSMSRequest = body;

            if (!walkthroughId) {
                throw new Error('Missing required field: walkthroughId');
            }

            // Get Authorization header to create authenticated Supabase client
            const authHeader = req.headers.get('Authorization');
            if (!authHeader) {
                throw new Error('No authorization header');
            }

            const token = authHeader.replace('Bearer ', '');
            const supabaseClient = createClient(
                Deno.env.get('SUPABASE_URL') ?? '',
                Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
            );

            // Get the authenticated user
            const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
            if (authError || !user?.id) {
                throw new Error('User not authenticated');
            }

            console.log('✓ User authenticated:', user.id);

            // Fetch walkthrough details
            const { data: walkthrough, error: walkthroughError } = await supabaseClient
                .from('walkthroughs')
                .select('*')
                .eq('id', walkthroughId)
                .single();

            if (walkthroughError || !walkthrough) {
                throw new Error('Walkthrough not found');
            }

            console.log('✓ Walkthrough loaded');

            // Fetch client or lead information
            let contactInfo: any = null;

            if (walkthrough.walkthrough_type === 'client' && walkthrough.client_id) {
                const { data: client, error: clientError } = await supabaseClient
                    .from('clients')
                    .select('*')
                    .eq('id', walkthrough.client_id)
                    .single();

                if (clientError || !client) {
                    throw new Error('Client not found');
                }
                contactInfo = client;
                console.log('✓ Client loaded:', client.full_name);
            } else if (walkthrough.walkthrough_type === 'lead' && walkthrough.lead_id) {
                // Try leads table first
                const { data: lead } = await supabaseClient
                    .from('leads')
                    .select('*')
                    .eq('id', walkthrough.lead_id)
                    .maybeSingle();

                if (lead) {
                    contactInfo = lead;
                    console.log('✓ Lead loaded from leads table:', lead.full_name || lead.lead_name);
                } else {
                    // Try bookings table
                    const { data: booking } = await supabaseClient
                        .from('bookings')
                        .select('*')
                        .eq('id', walkthrough.lead_id)
                        .maybeSingle();
                    contactInfo = booking;
                    console.log('✓ Lead loaded from bookings table:', booking?.lead_name);
                }
            }

            if (!contactInfo) {
                throw new Error('Contact information not found');
            }

            // Check if contact has phone number
            if (!contactInfo.phone) {
                console.warn('⚠️ No phone number found for contact');
                return new Response(
                    JSON.stringify({
                        success: false,
                        message: 'Contact does not have a phone number',
                        contactHasPhone: false
                    }),
                    {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                        status: 200,
                    }
                );
            }

            // Fetch company info
            const { data: companyInfo, error: companyError } = await supabaseClient
                .from('profiles')
                .select('company_name, company_phone, timezone')
                .eq('user_id', user.id)
                .single();

            if (companyError) {
                console.warn('Could not load company info:', companyError.message);
            }

            const companyName = companyInfo?.company_name || 'Thunder Pro';

            // Twilio credentials
            const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
            const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
            const twilioPhone = Deno.env.get('TWILIO_PHONE_NUMBER');

            if (!accountSid || !authToken || !twilioPhone) {
                throw new Error('Missing Twilio credentials');
            }

            // Normalize phone number
            const normalizedPhone = normalizePhoneNumber(contactInfo.phone);
            console.log("Phone number normalized:", contactInfo.phone, "->", normalizedPhone);

            // Create SMS message
            const message = `Thank you! Your walkthrough with ${companyName} has been completed. We're now preparing your personalized estimate and will send it to you within 24 hours.`;

            console.log("=== PREPARING SMS MESSAGE ===");
            console.log("Message text that will be sent:", message);
            console.log("Message length:", message.length, "characters");
            console.log("Recipient phone:", normalizedPhone);
            console.log("From phone:", twilioPhone);

            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

            console.log("=== SENDING SMS VIA TWILIO ===");
            console.log("Final SMS message text:", message);

            const response = await fetch(twilioUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
                },
                body: new URLSearchParams({
                    To: normalizedPhone,
                    From: twilioPhone,
                    Body: message,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || data.error_message || 'Failed to send SMS');
            }

            console.log('✅ SMS sent successfully:', data.sid);

            return new Response(
                JSON.stringify({
                    success: true,
                    messageSid: data.sid,
                    message: 'SMS sent successfully'
                }),
                {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 200,
                }
            );
        } catch (error: any) {
            Sentry.captureException(error);
            console.error("❌ Error in send-walkthrough-completion-sms:", error);
            return new Response(
                JSON.stringify({ error: error?.message || 'Internal server error' }),
                {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 500,
                }
            );
        }
    });
});
