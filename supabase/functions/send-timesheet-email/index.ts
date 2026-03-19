import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TimesheetEmailRequest {
  email: string;
  employeeName: string;
  dateRange: string;
  pdfBlob: string; // Base64 encoded PDF
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, employeeName, dateRange, pdfBlob }: TimesheetEmailRequest = await req.json();

    console.log('Sending timesheet email to:', email);

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    
    if (!resendApiKey) {
      throw new Error('Missing Resend API key');
    }

    const resend = new Resend(resendApiKey);

    const { data, error } = await resend.emails.send({
      from: 'Timesheet <onboarding@resend.dev>',
      to: [email],
      subject: `Your Timesheet - ${dateRange}`,
      html: `
        <h1>Hi ${employeeName},</h1>
        <p>Your timesheet for <strong>${dateRange}</strong> is attached to this email.</p>
        <p>Please review it and contact us if you have any questions.</p>
        <p>Best regards,<br>Your Team</p>
      `,
      attachments: [
        {
          filename: `Timesheet_${employeeName.replace(/\s+/g, '_')}_${dateRange.replace(/\s+/g, '_')}.pdf`,
          content: pdfBlob,
        },
      ],
    });

    if (error) {
      throw error;
    }

    console.log('Email sent successfully:', data);

    return new Response(
      JSON.stringify({ success: true, emailId: data?.id }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('Error sending timesheet email:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
