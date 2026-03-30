// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
//
// @ts-ignore
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";
import * as Sentry from "npm:@sentry/deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Sentry.init({
  dsn: "https://ce035a76b6157a602d88c53eab6570e4@o4509804047958016.ingest.us.sentry.io/4510552540971008",
  environment: Deno.env.get("SUPABASE_URL")?.includes("staging") ? "staging" : "production",
  tracesSampleRate: 0.1,
});

interface MarkViewedRequest {
  type: "estimate" | "invoice" | "contract";
  id: string;
}

serve(async (req) => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "mark-viewed");

    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Parse URL to get query parameters (for tracking pixel GET requests)
      const url = new URL(req.url);
      const type = url.searchParams.get("type") as "estimate" | "invoice" | "contract" | null;
      const id = url.searchParams.get("id");

      console.log(`[mark-viewed] Function invoked. Type: ${type}, ID: ${id}`);

      if (!type || !id) {
        console.error("[mark-viewed] Missing required parameters");
        throw new Error("Missing required parameters: type and id");
      }

      if (type !== "estimate" && type !== "invoice" && type !== "contract") {
        console.error("[mark-viewed] Invalid type:", type);
        throw new Error("Invalid type: use estimate, invoice, or contract");
      }

      // Create Supabase client
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const tableName = type === "estimate"
        ? "estimates"
        : type === "invoice"
        ? "invoices"
        : "contracts";

      const selectColumns = type === "contract" ? "viewed_at, status" : "viewed_at";

      // Check if already viewed
      console.log(`[mark-viewed] Fetching record from ${tableName} for ID ${id}`);
      const { data: existing, error: fetchError } = await supabase
        .from(tableName)
        .select(selectColumns)
        .eq("id", id)
        .single();

      if (fetchError) {
        console.error("[mark-viewed] Error fetching record:", fetchError);
        throw new Error(`Failed to fetch ${type}`);
      }

      // Only update if not already viewed
      if (!existing.viewed_at) {
        const updates: Record<string, string> = { viewed_at: new Date().toISOString() };

        if (type === "estimate") {
          updates.status = "Viewed";
        }
        if (type === "contract") {
          const st = (existing as { status?: string }).status;
          if (st === "Sent") {
            updates.status = "Pending";
          }
          updates.updated_at = new Date().toISOString();
        }

        const { error: updateError } = await supabase
          .from(tableName)
          .update(updates)
          .eq("id", id);

        if (updateError) {
          console.error("Error updating record:", updateError);
          throw new Error(`Failed to mark ${type} as viewed`);
        }

        console.log(`Successfully marked ${type} ${id} as viewed`);
      } else {
        console.log(`${type} ${id} was already viewed at ${existing.viewed_at}`);
      }

      // Return a 1x1 transparent pixel image for tracking pixel requests
      const transparentPixel = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));

      return new Response(transparentPixel, {
        headers: {
          ...corsHeaders,
          "Content-Type": "image/gif",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0"
        },
        status: 200,
      });
    } catch (error: any) {
      Sentry.captureException(error);
      console.error("Error in mark-viewed function:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }
  });
});