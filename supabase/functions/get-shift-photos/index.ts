import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveStoragePublicUrl } from "../_shared/resolveStoragePublicUrl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "shift-photos";

interface GetPhotosRequest {
  employee_id: string;
  phone: string;
  time_entry_id: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body: GetPhotosRequest = await req.json();
    const { employee_id, phone, time_entry_id } = body;

    if (!employee_id || !phone || !time_entry_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: employee_id, phone, time_entry_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Authenticate employee ─────────────────────────────────────────────────
    const { data: employee, error: empError } = await supabase
      .from("employees")
      .select("id, phone")
      .eq("id", employee_id)
      .eq("phone", phone)
      .maybeSingle();

    if (empError || !employee) {
      return new Response(
        JSON.stringify({ error: "Employee not found or phone number does not match" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Fetch photo rows ──────────────────────────────────────────────────────
    const { data: photos, error: photosError } = await supabase
      .from("time_entry_photos")
      .select("id, photo_type, storage_path, caption, taken_at, created_at")
      .eq("time_entry_id", time_entry_id)
      .eq("employee_id", employee_id)
      .order("taken_at", { ascending: true });

    if (photosError) {
      console.error("Error fetching photos:", photosError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch photos" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!photos || photos.length === 0) {
      return new Response(
        JSON.stringify({ success: true, photos: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Same display pattern as dashboard request attachments: public URL from path
    // (not short-lived signed URLs that embed the internal Kong host).
    const result = photos.map((p) => {
      const publicUrl = resolveStoragePublicUrl(BUCKET, p.storage_path);
      return {
        id: p.id,
        photo_type: p.photo_type,
        storage_path: p.storage_path,
        public_url: publicUrl,
        // Keep signed_url for older Crew builds that only read this field.
        signed_url: publicUrl,
        caption: p.caption,
        taken_at: p.taken_at,
        created_at: p.created_at,
      };
    });

    console.log(`Returning ${result.length} photos for time_entry ${time_entry_id}`);

    return new Response(
      JSON.stringify({ success: true, photos: result }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Unexpected error in get-shift-photos:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
