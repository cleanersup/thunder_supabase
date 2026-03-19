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

interface PasswordResetEmailRequest {
  email: string;
  appUrl: string;
}

// Password reset email template
const generatePasswordResetEmailTemplate = (resetLink: string, email: string): string => {
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
<p style="margin:5px 0">Password Reset Request</p>
</div>

<div class="email-content" style="padding:30px;background:white">

<h2 style="color:#1e3a8a;margin:0 0 20px 0;font-size:20px">Reset Your Password</h2>

<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px 0">
Hello,
</p>

<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px 0">
We received a request to reset the password for your Thunder Pro account associated with <strong>${email}</strong>.
</p>

<p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 25px 0">
Click the button below to reset your password. This link will expire in 1 hour for security reasons.
</p>

<div style="text-align:center;margin:30px 0">
<a href="${resetLink}" style="display:inline-block;background:#1e3a8a;color:white;padding:14px 40px;text-decoration:none;border-radius:5px;font-weight:bold;font-size:16px">Reset Password</a>
</div>

<p style="color:#374151;font-size:14px;line-height:1.6;margin:20px 0">
If the button doesn't work, copy and paste this link into your browser:
</p>
<p style="color:#3b82f6;font-size:13px;word-break:break-all;background:#eff6ff;padding:12px;border-radius:5px">
${resetLink}
</p>

<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;margin:25px 0">
<p style="margin:0;font-size:13px;color:#92400e">
⚠️ <strong>Security Notice:</strong> If you didn't request this password reset, please ignore this email or contact support if you have concerns about your account security.
</p>
</div>

<p style="color:#6b7280;font-size:13px;line-height:1.6;margin:25px 0 0 0">
This link will expire in 1 hour for your security.
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

// SMTP sending function (same as estimates)
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
      `X-Mailer: ThunderPro-PasswordReset`,
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
    Sentry.setTag("function", "send-password-reset-email");

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const { email }: { email: string } = await req.json();

      // Use PUBLIC_APP_URL from environment variables (required)
      // This is set differently for production (.env) and staging (.env.staging)
      const appUrl = Deno.env.get('PUBLIC_APP_URL');

      // Public Supabase URL (for replacing internal URLs in generated links)
      // This should be the public domain where Supabase backend is accessible
      // Note: This is different from appUrl - appUrl is frontend, publicSupabaseUrl is backend
      // IMPORTANT: Do NOT use SUPABASE_URL as fallback if it's an internal URL (kong, localhost, 127.0.0.1)
      let publicSupabaseUrl = Deno.env.get('PUBLIC_SUPABASE_URL_API');
      const supabaseUrl = Deno.env.get('SUPABASE_URL');

      // Only use SUPABASE_URL as fallback if it's NOT an internal URL
      if (!publicSupabaseUrl && supabaseUrl) {
        const isInternalUrl = supabaseUrl.includes('kong:8000') ||
          supabaseUrl.includes('127.0.0.1') ||
          supabaseUrl.includes('localhost') ||
          supabaseUrl.startsWith('http://127.0.0.1') ||
          supabaseUrl.startsWith('http://localhost');

        if (!isInternalUrl) {
          publicSupabaseUrl = supabaseUrl;
        }
      }

      console.log('Processing password reset email request for:', email);
      console.log('App URL (PUBLIC_APP_URL):', appUrl);
      console.log('Public Supabase URL:', publicSupabaseUrl);
      console.log('SUPABASE_URL (internal):', supabaseUrl);

      if (!email) {
        throw new Error('Missing required field: email');
      }

      if (!appUrl) {
        throw new Error('Missing required environment variable: PUBLIC_APP_URL');
      }

      if (!publicSupabaseUrl) {
        throw new Error('Missing required environment variable: PUBLIC_SUPABASE_URL_API must be set (SUPABASE_URL is internal and cannot be used)');
      }

      // Create Supabase admin client (use internal SUPABASE_URL for admin operations)
      const internalSupabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.76.1');
      const supabaseAdmin = createClient(internalSupabaseUrl, supabaseServiceKey);

      // Generate password recovery link using Supabase Admin API
      // The redirectTo should point to your app's reset-password page
      // Note: Token expiration is configured in supabase/config.toml (mailer_otp_exp)
      const { data, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email: email,
        options: {
          redirectTo: `${appUrl}/reset-password`
        }
      });

      if (linkError || !data) {
        console.error('Error generating reset link:', linkError);
        throw new Error('Failed to generate password reset link');
      }

      // Replace internal Supabase URL with public domain
      // CRITICAL: We must preserve the token signature exactly - any modification to hash/query can invalidate it
      // Supabase tokens are cryptographically signed and tied to the exact URL structure

      let resetLink = data.properties.action_link;

      // Step 1: Replace ONLY the base URL (protocol + host) - preserve path, query, and hash EXACTLY
      // This is safe because the token signature is in the path/query/hash, not the domain
      try {
        const url = new URL(resetLink);
        const publicUrl = new URL(publicSupabaseUrl);

        // List of internal hosts that need to be replaced
        const internalHosts = [
          'kong:8000',
          '127.0.0.1:54321',
          'localhost:54321',
          '127.0.0.1:3000',
          'localhost:3000'
        ];

        // Only replace if it's an internal host
        if (internalHosts.some(host => url.host === host || url.host.includes(host))) {
          // Replace ONLY protocol and host - preserve everything after the host exactly
          // This includes path, query string, and hash fragment without any modification
          const pathAndQuery = resetLink.substring(resetLink.indexOf(url.pathname));
          resetLink = `${publicUrl.protocol}//${publicUrl.host}${pathAndQuery}`;
          console.log(`Replaced internal host ${url.host} with ${publicUrl.host}`);
        }
      } catch (urlError) {
        // Fallback: simple string replacement for base URL only
        console.warn('URL parsing failed, using string replacement:', urlError);
        const baseUrlPatterns = [
          { pattern: /^https?:\/\/kong:8000/, replacement: publicSupabaseUrl },
          { pattern: /^https?:\/\/127\.0\.0\.1:54321/, replacement: publicSupabaseUrl },
          { pattern: /^https?:\/\/localhost:54321/, replacement: publicSupabaseUrl },
          { pattern: /^https?:\/\/127\.0\.0\.1:3000/, replacement: publicSupabaseUrl },
          { pattern: /^https?:\/\/localhost:3000/, replacement: publicSupabaseUrl }
        ];

        for (const { pattern, replacement } of baseUrlPatterns) {
          if (pattern.test(resetLink)) {
            // Extract everything after the host to preserve it exactly
            const match = resetLink.match(pattern);
            if (match) {
              const afterHost = resetLink.substring(match[0].length);
              resetLink = replacement + afterHost;
              console.log(`Replaced using string pattern: ${pattern}`);
            }
            break; // Only replace once
          }
        }
      }

      // Step 2: Fix redirect_to in query string ONLY (never touch hash fragment - it contains the token!)
      // The token signature is often in the hash fragment - modifying it invalidates the token
      // Use PUBLIC_APP_URL from environment variables for redirect
      const correctRedirect = `${appUrl}/reset-password`;

      // Only modify redirect_to in query string (before #), never in hash fragment
      // Split URL at # to avoid touching hash fragment
      const hashIndex = resetLink.indexOf('#');
      const beforeHash = hashIndex > -1 ? resetLink.substring(0, hashIndex) : resetLink;
      const hashFragment = hashIndex > -1 ? resetLink.substring(hashIndex) : '';

      // Fix redirect_to in query string only
      const redirectToQueryPattern = /([?&])redirect_to=([^&#]*)/;
      if (redirectToQueryPattern.test(beforeHash)) {
        const fixedBeforeHash = beforeHash.replace(redirectToQueryPattern, (match, prefix, value) => {
          try {
            const currentRedirect = decodeURIComponent(value);
            // Replace if it's localhost, staging, or doesn't match the correct redirect
            if (currentRedirect.includes('127.0.0.1') ||
              currentRedirect.includes('localhost') ||
              currentRedirect.includes('app.staging.thunderpro.co') ||
              currentRedirect.includes('staging.thunderpro.co') ||
              currentRedirect !== correctRedirect) {
              return `${prefix}redirect_to=${encodeURIComponent(correctRedirect)}`;
            }
          } catch (e) {
            // If decoding fails, replace it to be safe
            return `${prefix}redirect_to=${encodeURIComponent(correctRedirect)}`;
          }
          return match; // Keep original if it's valid
        });
        resetLink = fixedBeforeHash + hashFragment;
      }

      // IMPORTANT: Do NOT modify hash fragment - it contains the access_token and token signature
      // Modifying the hash fragment (even just redirect_to) can invalidate the token
      // The redirect_to in hash is handled by the frontend after token validation

      // Final safety check: if resetLink still contains internal URLs, force replacement
      if (resetLink.includes('kong:8000') || resetLink.includes('127.0.0.1') || resetLink.includes('localhost')) {
        console.warn('WARNING: Reset link still contains internal URL, forcing replacement');
        const internalPatterns = [
          { pattern: /^https?:\/\/kong:8000/, replacement: publicSupabaseUrl },
          { pattern: /^https?:\/\/127\.0\.0\.1:54321/, replacement: publicSupabaseUrl },
          { pattern: /^https?:\/\/localhost:54321/, replacement: publicSupabaseUrl },
          { pattern: /^https?:\/\/127\.0\.0\.1:3000/, replacement: publicSupabaseUrl },
          { pattern: /^https?:\/\/localhost:3000/, replacement: publicSupabaseUrl }
        ];

        for (const { pattern, replacement } of internalPatterns) {
          if (pattern.test(resetLink)) {
            const match = resetLink.match(pattern);
            if (match) {
              const afterHost = resetLink.substring(match[0].length);
              resetLink = replacement + afterHost;
              console.log('Forced replacement of internal URL');
              break;
            }
          }
        }
      }

      console.log('Generated reset link for:', email);
      console.log('Reset link (original):', data.properties.action_link);
      console.log('Reset link (fixed):', resetLink);

      // Generate HTML content
      const htmlContent = generatePasswordResetEmailTemplate(resetLink, email);
      const subject = 'Reset Your Thunder Pro Password';

      // Send email via AWS SES SMTP
      await sendEmailViaSMTP(email, subject, htmlContent);

      console.log('✓ Password reset email sent successfully to:', email);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Password reset email sent successfully',
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
      console.error('Error in send-password-reset-email function:', error);

      return new Response(
        JSON.stringify({
          success: false,
          error: error.message || 'Failed to send password reset email'
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
