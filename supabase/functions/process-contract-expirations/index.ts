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

/** Parse YYYY-MM-DD as UTC midnight for stable day diffs. */
function utcDayMs(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "N/A";
  try {
    return new Date(d + "T12:00:00.000Z").toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return String(d);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function daysFromTodayToEnd(todayStr: string, endDate: string): number {
  return Math.round((utcDayMs(endDate) - utcDayMs(todayStr)) / 86400000);
}

function generateOwnerExpiringEmailHtml(
  contract: Record<string, unknown>,
  companyName: string,
  endDateFormatted: string,
  daysLeft: number,
): string {
  const num = escapeHtml(String(contract.contract_number ?? ""));
  const recipient = escapeHtml(String(contract.recipient_name ?? ""));
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto">
<div style="text-align:center;padding:15px;background:#b45309;color:white">
<h1 style="margin:0;font-size:22px">${escapeHtml(companyName)}</h1>
<p style="margin:5px 0">Contract expiring soon</p>
</div>
<div style="padding:15px">
<p style="font-size:16px;line-height:1.5">Your service agreement is in its final month before the end date. Please review renewal or next steps in Thunder Pro.</p>
<h3 style="color:#1e3a8a;margin:20px 0 8px 0">Contract</h3>
<div style="border-top:1px solid #1e3a8a;margin-bottom:12px"></div>
<p><strong>Contract #:</strong> ${num}<br>
<strong>Client:</strong> ${recipient}<br>
<strong>Expiration date:</strong> ${escapeHtml(endDateFormatted)}<br>
<strong>Days remaining:</strong> ${daysLeft}</p>
<p style="margin-top:20px;color:#374151">This contract expires in about one month (${daysLeft} day${daysLeft === 1 ? "" : "s"} left on the calendar date above).</p>
</div>
<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Thunder Pro</p>
<p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>
</div>
</body>
</html>`;
}

async function sendEmailViaSMTP(toEmail: string, subject: string, htmlContent: string): Promise<void> {
  const smtpHost = "email-smtp.us-east-2.amazonaws.com";
  const smtpPort = 587;
  const smtpUser = Deno.env.get("AWS_SES_SMTP_USERNAME") || "";
  const smtpPass = Deno.env.get("AWS_SES_SMTP_PASSWORD") || "";
  const fromEmail = '"Thunder Pro" <info@thunderpro.co>';

  let conn: Deno.TcpConn | null = null;
  let tlsConn: Deno.TlsConn | null = null;

  try {
    conn = await Deno.connect({ hostname: smtpHost, port: smtpPort });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const readResponse = async (connection: Deno.TcpConn | Deno.TlsConn): Promise<string> => {
      const buffer = new Uint8Array(4096);
      const n = await connection.read(buffer);
      return decoder.decode(buffer.subarray(0, n || 0));
    };

    const sendCommand = async (connection: Deno.TcpConn | Deno.TlsConn, command: string, maskInLog = false): Promise<string> => {
      const displayCommand = maskInLog ? command.substring(0, 15) + "..." : command;
      console.log("SMTP:", displayCommand);
      await connection.write(encoder.encode(command + "\r\n"));
      const response = await readResponse(connection);
      const responseCode = response.substring(0, 3);
      if (responseCode.startsWith("4") || responseCode.startsWith("5")) {
        throw new Error(`SMTP Error ${responseCode}: ${response.trim()}`);
      }
      return response;
    };

    await readResponse(conn);
    await sendCommand(conn, "EHLO thunderpro.co");
    await sendCommand(conn, "STARTTLS");
    tlsConn = await Deno.startTls(conn, { hostname: smtpHost });
    await sendCommand(tlsConn, "EHLO thunderpro.co");
    await tlsConn.write(encoder.encode("AUTH LOGIN\r\n"));
    await readResponse(tlsConn);
    await sendCommand(tlsConn, btoa(smtpUser), true);
    await sendCommand(tlsConn, btoa(smtpPass), true);
    await sendCommand(tlsConn, "MAIL FROM:<info@thunderpro.co>");
    await sendCommand(tlsConn, `RCPT TO:<${toEmail}>`);
    await sendCommand(tlsConn, "DATA");

    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const messageId = `<${timestamp}.${randomId}@thunderpro.co>`;
    const headers = [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      "X-Mailer: ThunderPro-Contract-Expiration",
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "",
    ].join("\r\n");

    await tlsConn.write(encoder.encode(headers + "\r\n"));
    const contentBytes = encoder.encode(htmlContent);
    const chunkSize = 4096;
    for (let i = 0; i < contentBytes.length; i += chunkSize) {
      await tlsConn.write(contentBytes.slice(i, Math.min(i + chunkSize, contentBytes.length)));
    }
    await tlsConn.write(encoder.encode("\r\n.\r\n"));
    await readResponse(tlsConn);
    await sendCommand(tlsConn, "QUIT");
    tlsConn.close();
  } catch (e: unknown) {
    try {
      if (tlsConn) tlsConn.close();
      if (conn) conn.close();
    } catch {
      /* ignore */
    }
    throw new Error(`Failed to send email: ${e instanceof Error ? e.message : String(e)}`);
  }
}

serve(async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "process-contract-expirations");

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const body = await req.json().catch(() => ({}));
      const contractId = typeof body.contractId === "string" ? body.contractId : undefined;

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const todayStr = todayUtcIso();
      console.log("process-contract-expirations UTC date:", todayStr);

      let expiredCount = 0;
      let expiringProcessed = 0;
      let expiringErrors = 0;

      if (contractId) {
        const { data: one, error: oneErr } = await supabase
          .from("contracts")
          .select("*")
          .eq("id", contractId)
          .maybeSingle();
        if (oneErr) throw oneErr;
        if (!one) {
          return new Response(
            JSON.stringify({ success: false, message: "Contract not found" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const end = one.end_date as string | null;
        const st = one.status as string;
        if (end && end < todayStr && (st === "Active" || st === "Expiring")) {
          const { error: uErr } = await supabase.from("contracts").update({ status: "Expired", updated_at: new Date().toISOString() }).eq(
            "id",
            contractId,
          );
          if (uErr) throw uErr;
          expiredCount = 1;
        } else if (
          st === "Active" &&
          end &&
          end > todayStr &&
          one.expiring_notice_sent_at == null &&
          daysFromTodayToEnd(todayStr, end) >= 1 &&
          daysFromTodayToEnd(todayStr, end) <= 30
        ) {
          const r = await processOneExpiring(supabase, one, todayStr);
          expiringProcessed = r.ok ? 1 : 0;
          expiringErrors = r.ok ? 0 : 1;
        }
        return new Response(
          JSON.stringify({ success: true, expiredCount, expiringProcessed, expiringErrors }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 1) Expire: end_date strictly before today (calendar), still Active or Expiring
      const { data: toExpire, error: expErr } = await supabase
        .from("contracts")
        .select("id")
        .in("status", ["Active", "Expiring"])
        .not("end_date", "is", null)
        .lt("end_date", todayStr);

      if (expErr) throw expErr;
      const expireIds = (toExpire ?? []).map((r) => r.id);
      if (expireIds.length > 0) {
        const { error: upErr } = await supabase
          .from("contracts")
          .update({ status: "Expired", updated_at: new Date().toISOString() })
          .in("id", expireIds);
        if (upErr) throw upErr;
        expiredCount = expireIds.length;
        console.log(`Marked ${expiredCount} contract(s) Expired`);
      }

      // 2) Expiring window: Active, 1–30 days until end_date, notice not sent
      const { data: candidates, error: candErr } = await supabase
        .from("contracts")
        .select("*")
        .eq("status", "Active")
        .is("expiring_notice_sent_at", null)
        .not("end_date", "is", null)
        .gt("end_date", todayStr);

      if (candErr) throw candErr;

      const inWindow = (candidates ?? []).filter((c) => {
        const end = c.end_date as string;
        const d = daysFromTodayToEnd(todayStr, end);
        return d >= 1 && d <= 30;
      });

      console.log(`Expiring candidates in 1–30 day window: ${inWindow.length}`);

      for (const row of inWindow) {
        const r = await processOneExpiring(supabase, row, todayStr);
        if (r.ok) expiringProcessed++;
        else expiringErrors++;
      }

      return new Response(
        JSON.stringify({
          success: true,
          expiredCount,
          expiringProcessed,
          expiringErrors,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (e: unknown) {
      console.error(e);
      Sentry.captureException(e);
      scope.setTag("function", "process-contract-expirations");
      return new Response(
        JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  });
});

async function processOneExpiring(
  supabase: ReturnType<typeof createClient>,
  contract: Record<string, unknown>,
  todayStr: string,
): Promise<{ ok: boolean }> {
  const id = contract.id as string;
  const endDate = contract.end_date as string;
  const daysLeft = daysFromTodayToEnd(todayStr, endDate);

  const { data: claimed, error: claimErr } = await supabase
    .from("contracts")
    .update({
      status: "Expiring",
      expiring_notice_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "Active")
    .is("expiring_notice_sent_at", null)
    .select("id")
    .maybeSingle();

  if (claimErr) {
    console.error("Claim failed", id, claimErr);
    return { ok: false };
  }
  if (!claimed) {
    console.log("Skip (already claimed)", id);
    return { ok: true };
  }

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("company_name, company_email")
    .eq("user_id", contract.user_id as string)
    .maybeSingle();

  const ownerEmail = profile?.company_email?.trim();
  if (profErr || !ownerEmail) {
    console.error("No owner email; reverting claim", id, profErr);
    await supabase
      .from("contracts")
      .update({
        status: "Active",
        expiring_notice_sent_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return { ok: false };
  }

  const companyName = (profile?.company_name as string)?.trim() || "Your company";
  const endFmt = formatDate(endDate);
  const html = generateOwnerExpiringEmailHtml(contract, companyName, endFmt, daysLeft);
  const subject = `Contract ${contract.contract_number} expires in one month (${endFmt})`;

  try {
    await sendEmailViaSMTP(ownerEmail, subject, html);
    console.log("Expiring notice sent", id, ownerEmail);
    return { ok: true };
  } catch (e) {
    console.error("SMTP failed; reverting claim", id, e);
    await supabase
      .from("contracts")
      .update({
        status: "Active",
        expiring_notice_sent_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    return { ok: false };
  }
}
