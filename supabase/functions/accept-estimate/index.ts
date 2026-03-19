import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
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

serve(async (req) => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "accept-estimate");

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(req.url);
      const estimateId = url.searchParams.get('id');

      if (!estimateId) {
        return new Response('Estimate ID is required', {
          status: 400,
          headers: corsHeaders
        });
      }

      // Initialize Supabase client
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      console.log('Accepting estimate:', estimateId);

      // Update estimate status to accepted
      const { data: estimate, error: updateError } = await supabase
        .from('estimates')
        .update({
          status: 'Accepted',
          updated_at: new Date().toISOString()
        })
        .eq('id', estimateId)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating estimate:', updateError);
        throw updateError;
      }

      console.log('Estimate accepted successfully:', estimate);

      // Return HTML success page
      const htmlResponse = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Estimate Accepted</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 16px;
            padding: 48px 32px;
            max-width: 500px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.2);
          }
          .success-icon {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
          }
          .checkmark {
            width: 40px;
            height: 40px;
            border: 4px solid white;
            border-radius: 50%;
            position: relative;
          }
          .checkmark::after {
            content: '';
            position: absolute;
            left: 8px;
            top: 3px;
            width: 10px;
            height: 18px;
            border: solid white;
            border-width: 0 4px 4px 0;
            transform: rotate(45deg);
          }
          h1 {
            color: #1e3a8a;
            font-size: 28px;
            margin-bottom: 16px;
          }
          p {
            color: #555;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 32px;
          }
          .footer {
            color: #999;
            font-size: 14px;
            margin-top: 24px;
            padding-top: 24px;
            border-top: 1px solid #e5e7eb;
          }
          .footer a {
            color: #3b82f6;
            text-decoration: none;
            font-weight: 600;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">
            <div class="checkmark"></div>
          </div>
          <h1>Estimate Accepted!</h1>
          <p>Thank you for accepting our estimate. We've received your confirmation and will be in touch shortly to schedule your service.</p>
          <p style="font-size: 14px; color: #777;">A confirmation has been sent to your email address.</p>
          <div class="footer">
            <p>© 2024 Thunder Pro Inc.<br>
            Visit us at <a href="https://www.thunderpro.co" target="_blank">www.thunderpro.co</a></p>
          </div>
        </div>
      </body>
      </html>
    `;

      return new Response(htmlResponse, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html; charset=utf-8',
        },
      });

    } catch (error: any) {
      Sentry.captureException(error);
      console.error('Error in accept-estimate function:', error);

      const errorHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error</title>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 16px;
            padding: 48px 32px;
            max-width: 500px;
            width: 100%;
            text-align: center;
          }
          h1 { color: #dc2626; margin-bottom: 16px; }
          p { color: #555; margin-bottom: 24px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Oops! Something went wrong</h1>
          <p>We couldn't process your request. Please contact us directly or try again later.</p>
        </div>
      </body>
      </html>
    `;

      return new Response(errorHtml, {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }
  });
});
