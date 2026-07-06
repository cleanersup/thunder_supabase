import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushToEmployees, type PushMessage } from "../_shared/fcm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type EventType = "assigned" | "rescheduled" | "cancelled";

interface NotifyRequest {
  jobId: string;
  eventType: EventType;
}

interface JobRow {
  id: string;
  job_number: string | null;
  user_id: string;
  service_type: string;
  scheduled_date: string;
  start_time: string | null;
  client_name: string | null;
  property_street: string | null;
  property_apt: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  assigned_employees: unknown;
}

function normalizeEmployeeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === "string" ? item : (item as { id?: string })?.id))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

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
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  }).format(dateAtMidday);
}

function formatAddress(job: JobRow): string {
  const apt = job.property_apt ? ` ${job.property_apt}` : "";
  const cityStateZip = [job.property_city, job.property_state, job.property_zip].filter(Boolean).join(", ");
  return [job.property_street ? `${job.property_street}${apt}` : "", cityStateZip].filter(Boolean).join(", ");
}

function buildMessage(job: JobRow, eventType: EventType, timezone: string, companyName: string): PushMessage {
  const when = `${formatDate(job.scheduled_date, timezone)}${job.start_time ? ` at ${formatTime(job.start_time)}` : ""}`;
  const jobLabel = job.job_number ? `Job ${job.job_number}` : "A job";
  const client = job.client_name ? ` for ${job.client_name}` : "";

  const data: Record<string, string> = {
    type: `job_${eventType}`,
    job_id: job.id,
  };

  switch (eventType) {
    case "assigned":
      return {
        title: `New job assigned`,
        body: `${jobLabel}${client} on ${when}.`,
        data,
      };
    case "rescheduled":
      return {
        title: `Job rescheduled`,
        body: `${jobLabel}${client} is now ${when}.`,
        data,
      };
    case "cancelled":
      return {
        title: `Job cancelled`,
        body: `${jobLabel}${client} on ${when} was cancelled.`,
        data,
      };
  }
}

function buildSmsFallback(job: JobRow, eventType: EventType, timezone: string, companyName: string): string {
  const when = `${formatDate(job.scheduled_date, timezone)}${job.start_time ? ` at ${formatTime(job.start_time)}` : ""}`;
  const jobLabel = job.job_number ? `job ${job.job_number}` : "a job";
  const address = formatAddress(job);
  const addrSuffix = address ? ` Address: ${address}` : "";

  switch (eventType) {
    case "assigned":
      return `${companyName}: You've been assigned ${jobLabel} on ${when}.${addrSuffix}`;
    case "rescheduled":
      return `${companyName}: ${jobLabel} has been rescheduled to ${when}.${addrSuffix}`;
    case "cancelled":
      return `${companyName}: ${jobLabel} on ${when} has been cancelled.`;
  }
}

const normalizePhoneNumber = (phone: string): string => {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+1")) return cleaned;
  const digits = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
  return `+1${digits}`;
};

async function sendSms(toPhone: string, bodyText: string): Promise<void> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!accountSid || !authToken || !twilioPhone) {
    throw new Error("Missing Twilio credentials");
  }
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const resp = await fetch(twilioUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
    },
    body: new URLSearchParams({
      To: normalizePhoneNumber(toPhone),
      From: twilioPhone,
      Body: bodyText,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || "Failed to send SMS");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobId, eventType }: NotifyRequest = await req.json();

    if (!jobId || !eventType) {
      return new Response(JSON.stringify({ error: "jobId and eventType are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["assigned", "rescheduled", "cancelled"].includes(eventType)) {
      return new Response(JSON.stringify({ error: "Invalid eventType" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError || !job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const row = job as JobRow;
    const employeeIds = normalizeEmployeeIds(row.assigned_employees);

    if (employeeIds.length === 0) {
      return new Response(JSON.stringify({ success: true, skipped: "no_assigned_employees" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_name, timezone")
      .eq("user_id", row.user_id)
      .maybeSingle();

    const companyName = profile?.company_name || "Thunder Pro";
    const timezone = profile?.timezone || "America/New_York";

    // 1) Try push to all assigned employees.
    const pushMessage = buildMessage(row, eventType, timezone, companyName);
    let pushResult: { notifiedEmployeeIds: string[]; employeesWithoutToken: string[] };
    try {
      pushResult = await sendPushToEmployees(supabase, employeeIds, pushMessage);
    } catch (e) {
      // If push infra fails entirely (e.g. missing FCM secret), fall back to SMS for everyone.
      console.error("Push failed, falling back to SMS for all:", e);
      pushResult = { notifiedEmployeeIds: [], employeesWithoutToken: employeeIds };
    }

    // 2) SMS fallback only for employees without an active push token.
    let smsSent = 0;
    if (pushResult.employeesWithoutToken.length > 0) {
      const { data: employees } = await supabase
        .from("employees")
        .select("id, phone")
        .in("id", pushResult.employeesWithoutToken);

      const smsBody = buildSmsFallback(row, eventType, timezone, companyName);
      for (const emp of (employees ?? []) as { id: string; phone: string | null }[]) {
        if (!emp.phone) continue;
        try {
          await sendSms(emp.phone, smsBody);
          smsSent++;
        } catch (e) {
          console.error(`SMS fallback failed for employee ${emp.id}:`, e);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        event_type: eventType,
        pushed: pushResult.notifiedEmployeeIds.length,
        sms_fallback: smsSent,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in notify-job-employees:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
