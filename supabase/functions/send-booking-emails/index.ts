import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BookingEmailRequest {
  leadEmail: string;
  leadName: string;
  ownerEmail: string;
  companyName: string;
  bookingData: {
    serviceType: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
    preferredDate?: string;
    timePreference?: string;
    bedrooms?: number;
    bathrooms?: number;
    additionalServices?: string[];
    commercialPropertyType?: string;
    serviceDetails?: string;
  };
}

async function sendEmailViaSMTP(toEmail: string, subject: string, htmlContent: string): Promise<void> {
  const smtpHost = "email-smtp.us-east-2.amazonaws.com";
  const smtpPort = 587;
  const smtpUser = Deno.env.get('AWS_SES_SMTP_USERNAME') || '';
  const smtpPass = Deno.env.get('AWS_SES_SMTP_PASSWORD') || '';
  const fromEmail = Deno.env.get('AWS_SES_FROM_EMAIL') || '"Thunder Pro" <info@thunderpro.co>';

  if (!smtpUser || !smtpPass) {
    throw new Error('AWS SES SMTP credentials are missing. Check AWS_SES_SMTP_USERNAME and AWS_SES_SMTP_PASSWORD.');
  }

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

    const sendCommand = async (connection: Deno.TcpConn | Deno.TlsConn, command: string): Promise<string> => {
      await connection.write(encoder.encode(command + '\r\n'));
      const response = await readResponse(connection);
      const responseCode = response.substring(0, 3);
      if (responseCode.startsWith('4') || responseCode.startsWith('5')) {
        throw new Error(`SMTP Error ${responseCode}: ${response.trim()}`);
      }
      return response;
    };

    await readResponse(conn);
    await sendCommand(conn, 'EHLO thunderpro.co');
    await sendCommand(conn, 'STARTTLS');
    tlsConn = await Deno.startTls(conn, { hostname: smtpHost });
    await sendCommand(tlsConn, 'EHLO thunderpro.co');
    await tlsConn.write(encoder.encode('AUTH LOGIN\r\n'));
    await readResponse(tlsConn);
    await sendCommand(tlsConn, btoa(smtpUser));
    await sendCommand(tlsConn, btoa(smtpPass));
    await sendCommand(tlsConn, `MAIL FROM:<info@thunderpro.co>`);
    await sendCommand(tlsConn, `RCPT TO:<${toEmail}>`);
    await sendCommand(tlsConn, 'DATA');

    const messageId = `<${Date.now()}.${Math.random().toString(36).substring(2, 15)}@thunderpro.co>`;
    const headers = [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
    ].join('\r\n');

    await tlsConn.write(encoder.encode(headers + '\r\n'));
    const contentBytes = encoder.encode(htmlContent);
    for (let i = 0; i < contentBytes.length; i += 4096) {
      const chunk = contentBytes.slice(i, Math.min(i + 4096, contentBytes.length));
      await tlsConn.write(chunk);
    }
    await tlsConn.write(encoder.encode('\r\n.\r\n'));
    await readResponse(tlsConn);
    await sendCommand(tlsConn, 'QUIT');
    tlsConn.close();
  } catch (error: unknown) {
    try {
      if (tlsConn) tlsConn.close();
      if (conn) conn.close();
    } catch { }
    throw error;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      leadEmail,
      leadName,
      ownerEmail,
      companyName,
      bookingData
    }: BookingEmailRequest = await req.json();

    console.log('Sending booking emails to:', { leadEmail, ownerEmail });

    // Email 1: Confirmation to Lead
    const leadEmailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; }
            .content { background-color: #f9f9f9; padding: 30px; }
            .details { background-color: white; padding: 20px; margin: 20px 0; border-radius: 8px; }
            .detail-row { padding: 10px 0; border-bottom: 1px solid #eee; }
            .detail-label { font-weight: bold; color: #4F46E5; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Thank You for Your Booking Request!</h1>
            </div>
            <div class="content">
              <p>Dear ${leadName},</p>
              <p>We have received your cleaning service request. Here are the details we received:</p>
              
              <div class="details">
                <div class="detail-row">
                  <span class="detail-label">Service Type:</span> ${bookingData.serviceType}
                </div>
                <div class="detail-row">
                  <span class="detail-label">Address:</span> ${bookingData.address}, ${bookingData.city}, ${bookingData.state} ${bookingData.zip}
                </div>
                <div class="detail-row">
                  <span class="detail-label">Phone:</span> ${bookingData.phone}
                </div>
                <div class="detail-row">
                  <span class="detail-label">Email:</span> ${leadEmail}
                </div>
                ${bookingData.preferredDate ? `
                <div class="detail-row">
                  <span class="detail-label">Preferred Date:</span> ${bookingData.preferredDate}
                </div>
                ` : ''}
                ${bookingData.timePreference ? `
                <div class="detail-row">
                  <span class="detail-label">Time Preference:</span> ${bookingData.timePreference}
                </div>
                ` : ''}
                ${bookingData.bedrooms ? `
                <div class="detail-row">
                  <span class="detail-label">Bedrooms:</span> ${bookingData.bedrooms}
                </div>
                ` : ''}
                ${bookingData.bathrooms ? `
                <div class="detail-row">
                  <span class="detail-label">Bathrooms:</span> ${bookingData.bathrooms}
                </div>
                ` : ''}
                ${bookingData.additionalServices && bookingData.additionalServices.length > 0 ? `
                <div class="detail-row">
                  <span class="detail-label">Additional Services:</span> ${bookingData.additionalServices.join(', ')}
                </div>
                ` : ''}
                ${bookingData.commercialPropertyType ? `
                <div class="detail-row">
                  <span class="detail-label">Property Type:</span> ${bookingData.commercialPropertyType}
                </div>
                ` : ''}
                ${bookingData.serviceDetails ? `
                <div class="detail-row">
                  <span class="detail-label">Additional Details:</span> ${bookingData.serviceDetails}
                </div>
                ` : ''}
              </div>

              <p>We will contact you shortly to confirm your appointment and discuss any additional details.</p>
              <p>Thank you for choosing ${companyName}!</p>
            </div>
            <div class="footer">
              <p>This is an automated confirmation email from ${companyName}</p>
            </div>
          </div>
        </body>
      </html>
    `;

    // Email 2: Notification to Business Owner
    const ownerEmailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #10B981; color: white; padding: 20px; text-align: center; }
            .content { background-color: #f9f9f9; padding: 30px; }
            .details { background-color: white; padding: 20px; margin: 20px 0; border-radius: 8px; }
            .detail-row { padding: 10px 0; border-bottom: 1px solid #eee; }
            .detail-label { font-weight: bold; color: #10B981; }
            .highlight { background-color: #D1FAE5; padding: 15px; border-radius: 8px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Congratulations! New Lead Request</h1>
            </div>
            <div class="content">
              <div class="highlight">
                <h2 style="margin-top: 0; color: #10B981;">New Cleaning Service Request</h2>
                <p><strong>${leadName}</strong> has submitted a booking request for cleaning services!</p>
              </div>
              
              <h3>Lead Contact Information:</h3>
              <div class="details">
                <div class="detail-row">
                  <span class="detail-label">Name:</span> ${leadName}
                </div>
                <div class="detail-row">
                  <span class="detail-label">Email:</span> ${leadEmail}
                </div>
                <div class="detail-row">
                  <span class="detail-label">Phone:</span> ${bookingData.phone}
                </div>
              </div>

              <h3>Service Details:</h3>
              <div class="details">
                <div class="detail-row">
                  <span class="detail-label">Service Type:</span> ${bookingData.serviceType}
                </div>
                <div class="detail-row">
                  <span class="detail-label">Service Address:</span> ${bookingData.address}, ${bookingData.city}, ${bookingData.state} ${bookingData.zip}
                </div>
                ${bookingData.preferredDate ? `
                <div class="detail-row">
                  <span class="detail-label">Preferred Date:</span> ${bookingData.preferredDate}
                </div>
                ` : ''}
                ${bookingData.timePreference ? `
                <div class="detail-row">
                  <span class="detail-label">Time Preference:</span> ${bookingData.timePreference}
                </div>
                ` : ''}
                ${bookingData.bedrooms ? `
                <div class="detail-row">
                  <span class="detail-label">Bedrooms:</span> ${bookingData.bedrooms}
                </div>
                ` : ''}
                ${bookingData.bathrooms ? `
                <div class="detail-row">
                  <span class="detail-label">Bathrooms:</span> ${bookingData.bathrooms}
                </div>
                ` : ''}
                ${bookingData.additionalServices && bookingData.additionalServices.length > 0 ? `
                <div class="detail-row">
                  <span class="detail-label">Additional Services:</span> ${bookingData.additionalServices.join(', ')}
                </div>
                ` : ''}
                ${bookingData.commercialPropertyType ? `
                <div class="detail-row">
                  <span class="detail-label">Commercial Property Type:</span> ${bookingData.commercialPropertyType}
                </div>
                ` : ''}
                ${bookingData.serviceDetails ? `
                <div class="detail-row">
                  <span class="detail-label">Additional Details:</span> ${bookingData.serviceDetails}
                </div>
                ` : ''}
              </div>

              <p style="background-color: #FEF3C7; padding: 15px; border-radius: 8px; border-left: 4px solid #F59E0B;">
                <strong>Action Required:</strong> Please contact ${leadName} at ${bookingData.phone} or ${leadEmail} to confirm the appointment and provide a quote.
              </p>
            </div>
          </div>
        </body>
      </html>
    `;

    await sendEmailViaSMTP(
      leadEmail,
      `Booking Confirmation - ${companyName}`,
      leadEmailHtml
    );

    await sendEmailViaSMTP(
      ownerEmail,
      `🎉 New Lead Request - ${leadName} requesting ${bookingData.serviceType}`,
      ownerEmailHtml
    );

    console.log('Both emails sent successfully');

    return new Response(
      JSON.stringify({ success: true, message: 'Emails sent successfully' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Error sending emails:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});