import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BOOKINGS_FILES_BUCKET = 'route-files';

type BookingAttachmentMeta = {
  path: string;
  name: string;
  type: string;
  size: number;
  public_url: string;
};

function sanitizeFileName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isAllowedBookingFileType(file: File): boolean {
  if (!file.type) return false;
  return file.type.startsWith("image/") || file.type === "application/pdf";
}

function parseIntegerOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function parseJsonField<T>(raw: FormDataEntryValue | null, fallback: T): T {
  if (raw === null) return fallback;
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function uploadBookingFiles(
  supabase: ReturnType<typeof createClient>,
  formData: FormData,
  businessOwnerId: string,
  bookingId: string,
): Promise<BookingAttachmentMeta[]> {
  const fileEntries = formData.getAll("attachments");
  const uploaded: BookingAttachmentMeta[] = [];

  for (const entry of fileEntries) {
    if (!(entry instanceof File) || entry.size === 0) continue;

    if (!isAllowedBookingFileType(entry)) {
      throw new Error(`Unsupported file type for "${entry.name}". Allowed: image/*, application/pdf`);
    }

    const safeName = sanitizeFileName(entry.name || "file");
    const storagePath = `${businessOwnerId}/bookings/${bookingId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(BOOKINGS_FILES_BUCKET)
      .upload(storagePath, entry, {
        contentType: entry.type || undefined,
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Failed to upload "${entry.name}": ${uploadError.message}`);
    }

    const { data: pub } = supabase.storage.from(BOOKINGS_FILES_BUCKET).getPublicUrl(storagePath);
    uploaded.push({
      path: storagePath,
      name: entry.name,
      type: entry.type,
      size: entry.size,
      public_url: pub.publicUrl,
    });
  }

  return uploaded;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get("content-type") || "";

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let business_owner_id: string | null = null;
    let lead_name: string | null = null;
    let email: string | null = null;
    let phone: string | null = null;
    let service_type: string | null = null;
    let street: string | null = null;
    let apt_suite: string | null = null;
    let city: string | null = null;
    let state: string | null = null;
    let zip_code: string | null = null;
    let preferred_date: string | null = null;
    let time_preference: string | null = null;
    let bedrooms: number | null = null;
    let bathrooms: number | null = null;
    let additional_services: unknown[] = [];
    let commercial_property_type: string | null = null;
    let other_commercial_type: string | null = null;
    let service_details: string | null = null;
    let custom_answers: Record<string, unknown> = {};
    let status = 'new';
    let attachments: BookingAttachmentMeta[] = [];
    const bookingId = crypto.randomUUID();

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();

      business_owner_id = (formData.get("business_owner_id") as string | null)?.trim() || null;
      lead_name = (formData.get("lead_name") as string | null)?.trim() || null;
      email = (formData.get("email") as string | null)?.trim() || null;
      phone = (formData.get("phone") as string | null)?.trim() || null;
      service_type = (formData.get("service_type") as string | null)?.trim() || null;
      street = (formData.get("street") as string | null)?.trim() || null;
      apt_suite = (formData.get("apt_suite") as string | null)?.trim() || null;
      city = (formData.get("city") as string | null)?.trim() || null;
      state = (formData.get("state") as string | null)?.trim() || null;
      zip_code = (formData.get("zip_code") as string | null)?.trim() || null;
      preferred_date = (formData.get("preferred_date") as string | null)?.trim() || null;
      time_preference = (formData.get("time_preference") as string | null)?.trim() || null;
      bedrooms = parseIntegerOrNull(formData.get("bedrooms"));
      bathrooms = parseIntegerOrNull(formData.get("bathrooms"));
      commercial_property_type = (formData.get("commercial_property_type") as string | null)?.trim() || null;
      other_commercial_type = (formData.get("other_commercial_type") as string | null)?.trim() || null;
      service_details = (formData.get("service_details") as string | null)?.trim() || null;
      status = ((formData.get("status") as string | null)?.trim() || "new");
      additional_services = parseJsonField<unknown[]>(formData.get("additional_services"), []);
      custom_answers = parseJsonField<Record<string, unknown>>(formData.get("custom_answers"), {});

      if (business_owner_id) {
        attachments = await uploadBookingFiles(supabase, formData, business_owner_id, bookingId);
      }
    } else {
      const body = await req.json();
      business_owner_id = body.business_owner_id ?? null;
      lead_name = body.lead_name ?? null;
      email = body.email ?? null;
      phone = body.phone ?? null;
      service_type = body.service_type ?? null;
      street = body.street ?? null;
      apt_suite = body.apt_suite ?? null;
      city = body.city ?? null;
      state = body.state ?? null;
      zip_code = body.zip_code ?? null;
      preferred_date = body.preferred_date ?? null;
      time_preference = body.time_preference ?? null;
      bedrooms = parseIntegerOrNull(body.bedrooms);
      bathrooms = parseIntegerOrNull(body.bathrooms);
      additional_services = Array.isArray(body.additional_services) ? body.additional_services : [];
      commercial_property_type = body.commercial_property_type ?? null;
      other_commercial_type = body.other_commercial_type ?? null;
      service_details = body.service_details ?? null;
      custom_answers = body.custom_answers && typeof body.custom_answers === "object"
        ? body.custom_answers
        : {};
      status = body.status || 'new';
      attachments = Array.isArray(body.attachments) ? body.attachments : [];
    }

    if (!business_owner_id || !lead_name || !email || !phone || !street || !city || !state || !zip_code || !service_type) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const normalizedServiceType = String(service_type).toLowerCase();
    if (normalizedServiceType !== 'residential' && normalizedServiceType !== 'commercial') {
      return new Response(
        JSON.stringify({ error: "service_type must be 'residential' or 'commercial'" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data, error } = await supabase
      .from('bookings')
      .insert({
        id: bookingId,
        business_owner_id,
        lead_name,
        email,
        phone,
        service_type: normalizedServiceType,
        street,
        apt_suite: apt_suite || null,
        city,
        state,
        zip_code,
        preferred_date: preferred_date || null,
        time_preference: time_preference || null,
        bedrooms,
        bathrooms,
        additional_services: additional_services || [],
        commercial_property_type: commercial_property_type || null,
        other_commercial_type: other_commercial_type || null,
        service_details: service_details || null,
        custom_answers: custom_answers || {},
        attachments,
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
