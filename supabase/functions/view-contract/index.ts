import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";
import * as Sentry from "npm:@sentry/deno";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Sentry.init({
  dsn: "https://ce035a76b6157a602d88c53eab6570e4@o4509804047958016.ingest.us.sentry.io/4510552540971008",
  environment: Deno.env.get("SUPABASE_URL")?.includes("staging") ? "staging" : "production",
  tracesSampleRate: 0.1,
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Public HTML page for contract links sent by SMS (parity with email body):
 * tracking pixel → mark-viewed (Sent → Pending), Accept Contract, Download PDF.
 */
serve(async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async () => {
    Sentry.setTag("function", "view-contract");
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    try {
      const url = new URL(req.url);
      const token = url.searchParams.get("token");
      if (!token) {
        return new Response(
          `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invalid link</title></head><body><p>Missing contract link.</p></body></html>`,
          { status: 400, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
        );
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const supabase = createClient(supabaseUrl, serviceKey);

      const { data: byToken } = await supabase.from("contracts").select("*").eq("public_share_token", token).maybeSingle();
      let row = byToken;
      if (!row) {
        const { data: byId } = await supabase.from("contracts").select("*").eq("id", token).maybeSingle();
        row = byId;
      }

      if (!row) {
        return new Response(
          `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not found</title></head><body><p>We could not find this agreement.</p></body></html>`,
          { status: 404, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
        );
      }

      const contractId = String(row.id);
      const pdfToken = String(row.public_share_token || row.id);
      const origin = url.origin;
      const markViewedUrl =
        `${origin}/functions/v1/mark-viewed?type=contract&id=${encodeURIComponent(contractId)}`;
      const acceptUrl =
        `${origin}/functions/v1/accept-contract?id=${encodeURIComponent(contractId)}`;
      const pdfUrl =
        `${origin}/functions/v1/download-contract-pdf?token=${encodeURIComponent(pdfToken)}`;

      const { data: profile } = await supabase.from("profiles").select("company_name").eq("user_id", row.user_id).maybeSingle();
      const companyName = escapeHtml(String(profile?.company_name || "Company Name"));
      const contractNum = escapeHtml(String(row.contract_number || ""));

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Service Agreement — ${companyName}</title>
  <style>
    body { margin:0; font-family: Arial, sans-serif; background:#f4f4f5; padding: 24px; }
    .wrap { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .banner { background: #1e3a8a; color: #fff; padding: 20px; text-align: center; }
    .banner h1 { margin: 0; font-size: 20px; }
    .banner p { margin: 8px 0 0; font-size: 14px; opacity: 0.95; }
    .content { padding: 24px; }
    .content p { color: #374151; line-height: 1.5; margin: 0 0 16px; }
    .actions { text-align: center; margin-top: 28px; }
    .actions a {
      display: inline-block; margin: 8px; padding: 14px 28px; text-decoration: none;
      border-radius: 5px; font-weight: bold; font-size: 15px;
    }
    .btn-accept { background: #10b981; color: #fff; }
    .btn-pdf { background: #1e3a8a; color: #fff; }
    .footer { text-align: center; padding: 16px; font-size: 12px; color: #6b7280; background: #f9fafb; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="banner">
      <h1>${companyName}</h1>
      <p>Service Agreement${contractNum ? ` · #${contractNum}` : ""}</p>
    </div>
    <div class="content">
      <p>Your service agreement is ready. You can accept it online or download a PDF copy.</p>
      <div class="actions">
        <a class="btn-accept" href="${acceptUrl}">Accept Contract</a>
        <a class="btn-pdf" href="${pdfUrl}">Download PDF</a>
      </div>
    </div>
    <div class="footer">© Thunder Pro Inc. · <a href="https://www.thunderpro.co" style="color:#3b82f6">thunderpro.co</a></div>
  </div>
  <img src="${markViewedUrl}" width="1" height="1" style="display:none" alt="" />
</body>
</html>`;

      return new Response(html, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    } catch (e: unknown) {
      Sentry.captureException(e);
      const message = e instanceof Error ? e.message : String(e);
      return new Response(
        `<!DOCTYPE html><html><body><p>Something went wrong. Please try again later.</p></body></html>`,
        { status: 500, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
      );
    }
  });
});
