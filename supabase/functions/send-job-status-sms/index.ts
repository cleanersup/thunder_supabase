import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface JobSMSRequest {
  jobId: string;
  newStatus: string;
  clientPhone: string;
  previousStatus?: string;
}

type JobRow = {
  id: string;
  job_number: string | null;
  user_id: string;
  service_type: string;
  scheduled_date: string;
  start_time: string | null;
  end_time: string | null;
  client_name: string | null;
  property_street: string | null;
  property_apt: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  invoice_ids: string[] | null;
};

const ALLOWED_STATUSES = new Set(["upcoming", "cancelled", "completed"]);

const normalizePhoneNumber = (phone: string): string => {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+1")) return cleaned;
  const digits = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
  return `+1${digits}`;
};

function formatTime(timeStr: string | null): string {
  if (!timeStr) return "";
  const [hours, minutes] = timeStr.split(":");
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
}

function formatDate(dateStr: string, timezone = "America/New_York"): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const dateAtMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: timezone,
  }).format(dateAtMidday);
}

function formatAddress(job: JobRow): string {
  const apt = job.property_apt ? `, ${job.property_apt}` : "";
  const cityStateZip = [job.property_city, job.property_state, job.property_zip].filter(Boolean).join(", ");
  return [job.property_street ? `${job.property_street}${apt}` : "", cityStateZip].filter(Boolean).join(", ");
}

async function resolveInvoicePaymentLink(
  supabase: ReturnType<typeof createClient>,
  invoiceIds: string[] | null | undefined,
): Promise<string | null> {
  if (!invoiceIds?.length) return null;

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, payment_token")
    .in("id", invoiceIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!invoice) return null;

  const publicAppUrl = Deno.env.get("PUBLIC_APP_URL") ||
    Deno.env.get("APP_URL") ||
    "https://app.staging.thunderpro.co";
  return `${publicAppUrl}/invoice/payment/${invoice.payment_token || invoice.id}`;
}

function buildClientMessage(
  job: JobRow,
  companyName: string,
  newStatus: string,
  previousStatus: string,
  timezone: string,
  paymentLink: string | null,
): string {
  const clientName = job.client_name || "there";
  const date = formatDate(job.scheduled_date, timezone);
  const time = formatTime(job.start_time);
  const timeSuffix = time ? ` at ${time}` : "";
  const address = formatAddress(job);

  if (newStatus === "completed") {
    let msg = `${companyName}: Hi ${clientName}, your job has been completed. Thank you!`;
    if (paymentLink) {
      msg += ` View and pay your invoice: ${paymentLink}`;
    }
    return msg;
  }

  if (newStatus === "cancelled") {
    return `${companyName}: Hi ${clientName}, your job scheduled for ${date}${timeSuffix} has been cancelled.`;
  }

  const isReschedule = ["upcoming", "today", "ongoing", "missed"].includes(previousStatus);
  if (isReschedule) {
    return `${companyName}: Hi ${clientName}, your job has been rescheduled to ${date}${timeSuffix}. Address: ${address}`;
  }

  return `${companyName}: Hi ${clientName}, your job is confirmed for ${date}${timeSuffix}. Address: ${address}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobId, newStatus, clientPhone, previousStatus } = await req.json() as JobSMSRequest;

    if (!jobId || !newStatus || !clientPhone) {
      return new Response(JSON.stringify({ error: "jobId, newStatus, and clientPhone are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!ALLOWED_STATUSES.has(newStatus)) {
      return new Response(JSON.stringify({ success: true, skipped: "status_not_notifiable" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const row = job as JobRow;

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_name, timezone")
      .eq("user_id", row.user_id)
      .maybeSingle();

    const companyName = profile?.company_name || "Thunder Pro";
    const timezone = profile?.timezone || "America/New_York";

    const paymentLink = newStatus === "completed"
      ? await resolveInvoicePaymentLink(supabase, row.invoice_ids)
      : null;

    const message = buildClientMessage(
      row,
      companyName,
      newStatus,
      previousStatus || "",
      timezone,
      paymentLink,
    );

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!accountSid || !authToken || !twilioPhone) {
      throw new Error("Missing Twilio credentials");
    }

    const normalizedPhone = normalizePhoneNumber(clientPhone);
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

    const response = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
      },
      body: new URLSearchParams({
        To: normalizedPhone,
        From: twilioPhone,
        Body: message,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || data.error_message || "Failed to send SMS");
    }

    return new Response(JSON.stringify({ success: true, sid: data.sid }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
