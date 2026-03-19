import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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

interface VerificationEmailRequest {
  email: string;
  verificationCode: string;
}

// Verification email template
const generateVerificationEmailTemplate = (verificationCode: string, email: string): string => {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
@media only screen and (max-width: 600px) {
  .email-container {
    max-width: 100% !important;
  }
  .email-body {
    padding: 10px !important;
  }
  .email-content {
    padding: 10px !important;
  }
}
</style>
</head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif;background-color:#ffffff">
<div class="email-container" style="max-width:600px;margin:0 auto">

<div class="email-body" style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<h1 style="margin:0;font-size:22px">Thunder Pro</h1>
<p style="margin:5px 0">Verify Your Email Address</p>
</div>

<div class="email-content" style="padding:30px;background:white">

<h2 style="color:#1e3a8a;margin:0 0 20px 0;font-size:20px">Welcome to Thunder Pro!</h2>

<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px 0">
Hello,
</p>

<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px 0">
Thank you for creating an account with Thunder Pro. To complete your registration, please verify your email address <strong>${email}</strong>.
</p>

<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 25px 0">
Your verification code is:
</p>

<div style="text-align:center;margin:30px 0">
<div style="display:inline-block;background:#eff6ff;color:#1e3a8a;padding:20px 40px;border-radius:8px;font-weight:bold;font-size:32px;letter-spacing:8px;border:2px solid #1e3a8a">
${verificationCode}
</div>
</div>

<p style="color:#374151;font-size:14px;line-height:1.6;margin:20px 0">
Enter this code in the verification screen to activate your account.
</p>

<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;margin:25px 0">
<p style="margin:0;font-size:13px;color:#92400e">
⚠️ <strong>Security Notice:</strong> If you didn't create an account with Thunder Pro, please ignore this email or contact support if you have concerns.
</p>
</div>

<p style="color:#6b7280;font-size:13px;line-height:1.6;margin:25px 0 0 0">
This code will expire in 10 minutes for your security.
</p>

</div>

<div style="text-align:center;padding:15px;background:#1e3a8a;color:white">
<p style="margin:0 0 5px 0;font-size:12px">Secure service provided by</p>
<p style="margin:0">© 2024 Thunder Pro Inc. | <a href="https://www.thunderpro.co" style="color:white">www.thunderpro.co</a></p>
</div>

</div>
</body>
</html>`;
};

// SMTP sending function
async function sendEmailViaSMTP(
  toEmail: string,
  subject: string,
  htmlContent: string
): Promise<void> {
  console.log('=== Starting SMTP Email Process ===');

  const smtpHost = "email-smtp.us-east-2.amazonaws.com";
  const smtpPort = 587;
  const smtpUser = Deno.env.get('AWS_SES_SMTP_USERNAME') || '';
  const smtpPass = Deno.env.get('AWS_SES_SMTP_PASSWORD') || '';
  const fromEmail = '"Thunder Pro" <info@thunderpro.co>';

  console.log('Configuration:', {
    smtpHost,
    smtpPort,
    fromEmail,
    toEmail,
    subject
  });

  let conn: Deno.TcpConn | null = null;
  let tlsConn: Deno.TlsConn | null = null;

  try {
    console.log('[1/10] Connecting to SMTP server:', `${smtpHost}:${smtpPort}...`);
    conn = await Deno.connect({ hostname: smtpHost, port: smtpPort });
    console.log('[1/10] ✓ TCP connection established');

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const readResponse = async (connection: Deno.TcpConn | Deno.TlsConn): Promise<string> => {
      const buffer = new Uint8Array(4096);
      const n = await connection.read(buffer);
      return decoder.decode(buffer.subarray(0, n || 0));
    };

    const sendCommand = async (
      connection: Deno.TcpConn | Deno.TlsConn,
      command: string,
      stepName: string,
      maskInLog: boolean = false
    ): Promise<string> => {
      const displayCommand = maskInLog ? command.substring(0, 15) + '...' : command;

      console.log(`${stepName} Sending: ${displayCommand}`);
      await connection.write(encoder.encode(command + '\r\n'));

      const response = await readResponse(connection);
      console.log(`${stepName} Response: ${response.trim()}`);

      const responseCode = response.substring(0, 3);
      if (responseCode.startsWith('4') || responseCode.startsWith('5')) {
        throw new Error(`SMTP Error ${responseCode}: ${response.trim()}`);
      }

      return response;
    };

    console.log('[2/10] Reading server greeting...');
    const greeting = await readResponse(conn);
    console.log('[2/10] ✓ Server greeting:', greeting.trim());

    await sendCommand(conn, 'EHLO thunderpro.co', '[3/10]');
    await sendCommand(conn, 'STARTTLS', '[4/10]');

    console.log('[5/10] Upgrading to TLS...');
    tlsConn = await Deno.startTls(conn, { hostname: smtpHost });
    console.log('[5/10] ✓ TLS established');

    await sendCommand(tlsConn, 'EHLO thunderpro.co', '[6/10]');

    console.log('[7/10] Sending: AUTH LOGIN...');
    await tlsConn.write(encoder.encode('AUTH LOGIN\r\n'));
    await readResponse(tlsConn);
    console.log('[7/10] Response: 334 VXNlcm5hbWU6');

    await sendCommand(tlsConn, btoa(smtpUser), '[7/10]', true);
    await sendCommand(tlsConn, btoa(smtpPass), '[7/10]', true);
    console.log('[7/10] ✓ Authentication successful');

    await sendCommand(tlsConn, `MAIL FROM:<info@thunderpro.co>`, '[8/10]');
    await sendCommand(tlsConn, `RCPT TO:<${toEmail}>`, '[8/10]');
    console.log('[8/10] Response: 250 Ok');

    await sendCommand(tlsConn, 'DATA', '[9/10]');

    // Build email headers
    console.log('[9/10] Sending email headers...');

    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const messageId = `<${timestamp}.${randomId}@thunderpro.co>`;
    const uniqueRef = `${timestamp}-${randomId}`;

    const headers = [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      `X-Entity-Ref-ID: ${uniqueRef}`,
      `X-Mailer: ThunderPro-EmailVerification`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
    ].join('\r\n');

    await tlsConn.write(encoder.encode(headers + '\r\n'));

    // Send HTML content in chunks
    console.log('[9/10] Sending email body in chunks...');
    const chunkSize = 4096;
    const contentBytes = encoder.encode(htmlContent);

    for (let i = 0; i < contentBytes.length; i += chunkSize) {
      const chunk = contentBytes.slice(i, Math.min(i + chunkSize, contentBytes.length));
      await tlsConn.write(chunk);
    }

    // Send end marker
    await tlsConn.write(encoder.encode('\r\n.\r\n'));

    const dataResponse = await readResponse(tlsConn);
    console.log('[9/10] ✓ Email sent:', dataResponse.trim());

    await sendCommand(tlsConn, 'QUIT', '[10/10]');
    tlsConn.close();
    console.log('=== Email sent successfully ===');

  } catch (error: any) {
    console.error('=== SMTP Error ===');
    console.error('Error:', error.message);

    try {
      if (tlsConn) tlsConn.close();
      if (conn) conn.close();
    } catch (closeError) {
      console.error('Error closing connections:', closeError);
    }

    throw new Error(`Failed to send email via SMTP: ${error.message}`);
  }
}

const handler = async (req: Request): Promise<Response> => {
  return await Sentry.withScope(async (scope) => {
    Sentry.setTag("function", "send-verification-email");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const { email, verificationCode }: VerificationEmailRequest = await req.json();

      console.log('Processing verification email request for:', email);

      if (!email || !verificationCode) {
        throw new Error('Missing required fields: email or verificationCode');
      }

      // Generate HTML content
      const htmlContent = generateVerificationEmailTemplate(verificationCode, email);
      const subject = 'Verify Your Thunder Pro Email Address';

      // Send email via AWS SES SMTP
      await sendEmailViaSMTP(email, subject, htmlContent);

      console.log('✓ Verification email sent successfully to:', email);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Verification email sent successfully',
          recipientEmail: email
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      );

    } catch (error: any) {
      Sentry.captureException(error);
      console.error('Error in send-verification-email function:', error);

      return new Response(
        JSON.stringify({
          success: false,
          error: error.message || 'Failed to send verification email'
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          },
        }
      );
    }
  });
};

serve(handler);
