import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "shift-photos";
/** Signed URL expiry in seconds (1 hour). */
const SIGNED_URL_TTL = 3600;

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

    // ── Generate signed URLs in bulk ──────────────────────────────────────────
    const paths = photos.map((p) => p.storage_path);
    const { data: signedUrls, error: signedError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL);

    if (signedError) {
      console.error("Error generating signed URLs:", signedError);
    }

    // Build a map of path → signed URL for quick lookup
    const urlMap = new Map<string, string>();
    if (signedUrls) {
      for (const entry of signedUrls) {
        if (entry.signedUrl) {
          urlMap.set(entry.path, entry.signedUrl);
        }
      }
    }

    const result = photos.map((p) => ({
      id: p.id,
      photo_type: p.photo_type,
      storage_path: p.storage_path,
      signed_url: urlMap.get(p.storage_path) ?? null,
      caption: p.caption,
      taken_at: p.taken_at,
      created_at: p.created_at,
    }));

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
