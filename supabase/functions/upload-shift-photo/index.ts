import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "shift-photos";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

interface UploadRequest {
  employee_id: string;
  phone: string;
  time_entry_id: string;
  photo_type: "before" | "after" | "during";
  /** Base-64 encoded image data (no data: prefix needed). */
  photo_base64: string;
  /** MIME type, e.g. "image/jpeg" */
  content_type: string;
  /** Optional caption for the photo. */
  caption?: string;
  /** ISO timestamp when the photo was taken on the device (optional). */
  taken_at?: string;
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

    const body: UploadRequest = await req.json();
    const { employee_id, phone, time_entry_id, photo_type, photo_base64, content_type, caption, taken_at } = body;

    // ── Validate required fields ──────────────────────────────────────────────
    if (!employee_id || !phone || !time_entry_id || !photo_type || !photo_base64 || !content_type) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: employee_id, phone, time_entry_id, photo_type, photo_base64, content_type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const validTypes = ["before", "after", "during"];
    if (!validTypes.includes(photo_type)) {
      return new Response(
        JSON.stringify({ error: `photo_type must be one of: ${validTypes.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Authenticate employee ─────────────────────────────────────────────────
    const { data: employee, error: empError } = await supabase
      .from("employees")
      .select("id, user_id, phone, first_name, last_name")
      .eq("id", employee_id)
      .eq("phone", phone)
      .maybeSingle();

    if (empError || !employee) {
      return new Response(
        JSON.stringify({ error: "Employee not found or phone number does not match" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Verify the time_entry belongs to this employee ────────────────────────
    const { data: timeEntry, error: teError } = await supabase
      .from("time_entries")
      .select("id, employee_id, user_id")
      .eq("id", time_entry_id)
      .eq("employee_id", employee_id)
      .maybeSingle();

    if (teError || !timeEntry) {
      return new Response(
        JSON.stringify({ error: "Time entry not found or does not belong to this employee" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Decode base64 and enforce size limit ──────────────────────────────────
    // Strip optional data URL prefix ("data:image/jpeg;base64,")
    const base64Data = photo_base64.replace(/^data:[^;]+;base64,/, "");
    const binaryString = atob(base64Data);
    if (binaryString.length > MAX_BYTES) {
      return new Response(
        JSON.stringify({ error: "Photo exceeds 10 MB limit" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // ── Build storage path ────────────────────────────────────────────────────
    // Pattern: {user_id}/{time_entry_id}/{photo_type}_{uuid}.{ext}
    const ext = content_type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
    const uniqueId = crypto.randomUUID();
    const storagePath = `${timeEntry.user_id}/${time_entry_id}/${photo_type}_${uniqueId}.${ext}`;

    // ── Upload to Storage ─────────────────────────────────────────────────────
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: content_type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return new Response(
        JSON.stringify({ error: "Failed to upload photo: " + uploadError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Insert metadata row ───────────────────────────────────────────────────
    const { data: photo, error: insertError } = await supabase
      .from("time_entry_photos")
      .insert({
        time_entry_id,
        employee_id,
        user_id: timeEntry.user_id,
        photo_type,
        storage_path: storagePath,
        caption: caption ?? null,
        taken_at: taken_at ?? new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error("DB insert error:", insertError);
      // Best-effort: remove the uploaded file since we can't track it
      await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
      return new Response(
        JSON.stringify({ error: "Failed to save photo metadata: " + insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Generate a 1-hour signed URL for immediate display ────────────────────
    const { data: signedUrlData } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 3600);

    console.log(`Photo uploaded: ${storagePath} for time_entry ${time_entry_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        photo: {
          id: photo.id,
          time_entry_id: photo.time_entry_id,
          photo_type: photo.photo_type,
          storage_path: photo.storage_path,
          signed_url: signedUrlData?.signedUrl ?? null,
          caption: photo.caption,
          taken_at: photo.taken_at,
          created_at: photo.created_at,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Unexpected error in upload-shift-photo:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
