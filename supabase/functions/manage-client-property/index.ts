// Validates JWT in Deno (reliable on self-hosted) and writes client_properties via service role.
// Frontend can call: supabase.functions.invoke('manage-client-property', { body: { action, ... } })

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type PropertyPayload = {
  title?: string | null;
  street: string;
  apt_suite?: string | null;
  city: string;
  state: string;
  zip_code: string;
  is_primary?: boolean;
};

type RequestBody =
  | { action: "create"; clientId: string; property: PropertyPayload }
  | { action: "update"; propertyId: string; property: PropertyPayload }
  | { action: "set_primary"; propertyId: string }
  | { action: "delete"; propertyId: string };

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getAuthedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: json({ error: "Unauthorized" }, 401) };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return { error: json({ error: "Unauthorized" }, 401) };
  }

  return { supabase, user };
}

async function assertClientExists(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  clientId: string,
) {
  const { data: client, error } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", clientId)
    .maybeSingle();

  if (error || !client) {
    return { error: json({ error: "Client not found" }, 404) };
  }

  if (client.user_id !== userId) {
    console.warn("[manage-client-property] clients.user_id mismatch (legacy row)", {
      clientId,
      clientUserId: client.user_id,
      jwtUserId: userId,
    });
  }

  return { client };
}

async function getPropertyForUser(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  propertyId: string,
) {
  const { data: property, error } = await supabase
    .from("client_properties")
    .select("id, client_id, user_id")
    .eq("id", propertyId)
    .maybeSingle();

  if (error || !property) {
    return { error: json({ error: "Property not found" }, 404) };
  }

  if (property.user_id !== userId) {
    return { error: json({ error: "Not authorized for this property" }, 403) };
  }

  return { property };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authed = await getAuthedUser(req);
    if ("error" in authed && authed.error) return authed.error;
    const { supabase, user } = authed as { supabase: ReturnType<typeof createClient>; user: { id: string } };

    const body = (await req.json()) as RequestBody;
    console.log("[manage-client-property]", body.action, { userId: user.id });

    if (body.action === "create") {
      if (!body.clientId || !body.property?.street) {
        return json({ error: "clientId and property.street are required" }, 400);
      }

      const access = await assertClientExists(supabase, user.id, body.clientId);
      if ("error" in access && access.error) return access.error;

      const { data, error } = await supabase
        .from("client_properties")
        .insert({
          user_id: user.id,
          client_id: body.clientId,
          title: body.property.title ?? null,
          street: body.property.street,
          apt_suite: body.property.apt_suite ?? null,
          city: body.property.city,
          state: body.property.state,
          zip_code: body.property.zip_code,
          is_primary: body.property.is_primary ?? false,
        })
        .select()
        .single();

      if (error) {
        console.error("[manage-client-property] create failed", error);
        return json({ error: error.message }, 400);
      }

      return json({ property: data });
    }

    if (body.action === "update") {
      if (!body.propertyId || !body.property?.street) {
        return json({ error: "propertyId and property.street are required" }, 400);
      }

      const existing = await getPropertyForUser(supabase, user.id, body.propertyId);
      if ("error" in existing && existing.error) return existing.error;

      const { data, error } = await supabase
        .from("client_properties")
        .update({
          title: body.property.title ?? null,
          street: body.property.street,
          apt_suite: body.property.apt_suite ?? null,
          city: body.property.city,
          state: body.property.state,
          zip_code: body.property.zip_code,
          is_primary: body.property.is_primary ?? false,
        })
        .eq("id", body.propertyId)
        .select()
        .single();

      if (error) {
        console.error("[manage-client-property] update failed", error);
        return json({ error: error.message }, 400);
      }

      return json({ property: data });
    }

    if (body.action === "set_primary") {
      if (!body.propertyId) {
        return json({ error: "propertyId is required" }, 400);
      }

      const existing = await getPropertyForUser(supabase, user.id, body.propertyId);
      if ("error" in existing && existing.error) return existing.error;

      const { error } = await supabase
        .from("client_properties")
        .update({ is_primary: true })
        .eq("id", body.propertyId);

      if (error) {
        console.error("[manage-client-property] set_primary failed", error);
        return json({ error: error.message }, 400);
      }

      return json({ ok: true });
    }

    if (body.action === "delete") {
      if (!body.propertyId) {
        return json({ error: "propertyId is required" }, 400);
      }

      const existing = await getPropertyForUser(supabase, user.id, body.propertyId);
      if ("error" in existing && existing.error) return existing.error;

      const { error } = await supabase
        .from("client_properties")
        .delete()
        .eq("id", body.propertyId);

      if (error) {
        console.error("[manage-client-property] delete failed", error);
        return json({ error: error.message }, 400);
      }

      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("[manage-client-property] unexpected error", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
