// Exchange one-time portal token for Supabase session (service role).
// Sets app_metadata.active_owner_id / active_client_id for RLS.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeRedirect(path: string): string {
  const p = path.trim() || "/invoices";
  if (!p.startsWith("/")) return "/invoices";
  if (p.startsWith("//")) return "/invoices";
  const allowedPrefixes = ["/invoices", "/contracts", "/wallet"];
  const ok = allowedPrefixes.some(
    (prefix) => p === prefix || p.startsWith(prefix + "/"),
  );
  return ok ? p : "/invoices";
}

async function findAuthUserIdByEmail(
  supabase: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) {
      console.error("listUsers page", page, error);
      return null;
    }
    const u = data.users.find(
      (x) => x.email?.toLowerCase() === email.toLowerCase(),
    );
    if (u) return u.id;
    if (data.users.length < 200) break;
  }
  return null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({})) as { token?: string };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
      return new Response(JSON.stringify({ error: "Invalid or expired link." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabase = createClient(supabaseUrl, serviceKey);

    const tokenHash = await sha256Hex(token);

    const { data: link, error: linkErr } = await supabase
      .from("client_magic_links")
      .select(
        "id, client_email, owner_id, redirect_to, expires_at, used_at, revoked_at",
      )
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (linkErr || !link) {
      console.error("validate link lookup:", linkErr);
      return new Response(JSON.stringify({ error: "Invalid or expired link." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (link.used_at || link.revoked_at) {
      return new Response(JSON.stringify({ error: "This link was already used." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "This link has expired." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const emailNorm = String(link.client_email).toLowerCase();
    const ownerId = String(link.owner_id);

    const { data: clientRow, error: clientErr } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", ownerId)
      .ilike("email", emailNorm)
      .maybeSingle();

    if (clientErr || !clientRow?.id) {
      console.error("validate client:", clientErr);
      return new Response(JSON.stringify({ error: "Invalid or expired link." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientId = clientRow.id as string;
    const redirectTo = normalizeRedirect(String(link.redirect_to || "/invoices"));

    const appMeta = {
      active_owner_id: ownerId,
      active_client_id: clientId,
    };

    let userId = await findAuthUserIdByEmail(supabase, emailNorm);

    if (!userId) {
      const password = crypto.randomUUID() + crypto.randomUUID();
      const { data: created, error: createErr } = await supabase.auth.admin
        .createUser({
          email: emailNorm,
          password,
          email_confirm: true,
          app_metadata: appMeta,
        });

      if (createErr || !created.user) {
        console.error("createUser:", createErr);
        return new Response(
          JSON.stringify({ error: "Could not complete sign-in. Try again." }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      userId = created.user.id;
    } else {
      const { error: updErr } = await supabase.auth.admin.updateUserById(
        userId,
        { app_metadata: appMeta },
      );
      if (updErr) {
        console.error("updateUser app_metadata:", updErr);
        return new Response(
          JSON.stringify({ error: "Could not complete sign-in. Try again." }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    const { data: linkGen, error: linkErr } = await supabase.auth.admin
      .generateLink({
        type: "magiclink",
        email: emailNorm,
      });

    const hashed = linkGen?.properties?.hashed_token;

    if (linkErr || !hashed) {
      console.error("generateLink:", linkErr, linkGen);
      return new Response(
        JSON.stringify({ error: "Could not complete sign-in. Try again." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!anonKey) {
      console.error("SUPABASE_ANON_KEY missing for verifyOtp");
      return new Response(
        JSON.stringify({ error: "Could not complete sign-in. Try again." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const verifyClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: authData, error: verifyErr } = await verifyClient.auth
      .verifyOtp({
        type: "email",
        token_hash: hashed,
      });

    if (verifyErr || !authData?.session) {
      console.error("verifyOtp:", verifyErr, authData);
      return new Response(
        JSON.stringify({ error: "Could not complete sign-in. Try again." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const session = authData.session;

    await supabase
      .from("client_magic_links")
      .update({ used_at: new Date().toISOString() })
      .eq("id", link.id)
      .is("used_at", null);

    return new Response(
      JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        token_type: session.token_type ?? "bearer",
        redirectTo,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("validate-client-portal-magic-link:", e);
    return new Response(JSON.stringify({ error: "Invalid or expired link." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
