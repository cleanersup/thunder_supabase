// Supabase Edge Function: revenuecat-webhook
// Purpose: Receive RevenueCat subscription events and sync plan status to profiles table.
// Security: Validates the Authorization Bearer token sent by RevenueCat.
//
// Required env vars:
//   REVENUECAT_WEBHOOK_AUTH_KEY  — shared secret configured in RevenueCat dashboard
//   SUPABASE_URL                 — injected automatically
//   SUPABASE_SERVICE_ROLE_KEY    — injected automatically

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// ─── Types ────────────────────────────────────────────────────────────────────

type RCEventType =
  | "INITIAL_PURCHASE"
  | "RENEWAL"
  | "CANCELLATION"
  | "UNCANCELLATION"
  | "EXPIRATION"
  | "BILLING_ISSUE"
  | "PRODUCT_CHANGE"
  | "TRANSFER"
  | "SUBSCRIBER_ALIAS"
  | "TEST";

interface RCEvent {
  type: RCEventType;
  app_user_id: string;
  original_app_user_id: string;
  aliases?: string[];
  product_id: string;
  period_type: string;
  purchased_at_ms: number | null;
  expiration_at_ms: number | null;
  environment: "PRODUCTION" | "SANDBOX";
  entitlement_ids: string[] | null;
  store: string;
  // PRODUCT_CHANGE fields
  new_product_id?: string;
}

interface RCPayload {
  event: RCEvent;
  api_version: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive plan_tier from entitlement_ids (preferred) or product_id (fallback).
 * Entitlement IDs are: "basic" | "essential" | "professional"
 */
function derivePlanTier(
  entitlementIds: string[] | null,
  productId: string,
): "basic" | "essential" | "professional" {
  // Prefer entitlements — more reliable than product_id
  if (entitlementIds && entitlementIds.length > 0) {
    if (entitlementIds.includes("professional")) return "professional";
    if (entitlementIds.includes("essential"))    return "essential";
    if (entitlementIds.includes("basic"))        return "basic";
  }

  // Fallback: parse product_id
  const pid = productId.toLowerCase();
  if (pid.includes("professional")) return "professional";
  if (pid.includes("essential"))    return "essential";

  // Catches "basic_*", legacy "monthly", "monthtrial3", "monthlyb1", etc.
  return "basic";
}

/** Convert RevenueCat epoch-ms timestamp to ISO string, or null. */
function epochToISO(ms: number | null): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the Supabase user UUID from a RevenueCat event.
 * RevenueCat may send anonymous IDs ($RCAnonymousID:...) when a purchase
 * happened before the user logged in. We check app_user_id first, then
 * original_app_user_id, then aliases, returning the first valid UUID found.
 * Returns null if no UUID is present — the event cannot be linked to a user.
 */
function resolveUserId(event: RCEvent): string | null {
  if (UUID_REGEX.test(event.app_user_id)) return event.app_user_id;
  if (UUID_REGEX.test(event.original_app_user_id)) return event.original_app_user_id;
  return event.aliases?.find((a) => UUID_REGEX.test(a)) ?? null;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  // RevenueCat does not send OPTIONS preflight for webhooks, but handle it anyway
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  // ── 1. Authenticate ────────────────────────────────────────────────────────
  // Auth is validated via ?rc_auth=<secret> query param (not Authorization header)
  // because Supabase self-hosted Kong intercepts and rejects non-JWT Authorization headers.
  const authKey = Deno.env.get("REVENUECAT_WEBHOOK_AUTH_KEY");
  if (!authKey) {
    console.error("[RC Webhook] REVENUECAT_WEBHOOK_AUTH_KEY not set");
    return new Response("Server misconfiguration", { status: 500 });
  }

  const url = new URL(req.url);
  const queryToken = url.searchParams.get("rc_auth") ?? "";

  if (queryToken !== authKey) {
    console.warn("[RC Webhook] Unauthorized request — invalid rc_auth param");
    return new Response("Unauthorized", { status: 401 });
  }

  // ── 2. Parse payload ───────────────────────────────────────────────────────
  let payload: RCPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const event = payload?.event;
  if (!event?.type || !event?.app_user_id) {
    return new Response("Missing event data", { status: 400 });
  }

  const { type, entitlement_ids, expiration_at_ms, environment } = event;
  const userId = resolveUserId(event);

  console.log(`[RC Webhook] Event: ${type} | RC user: ${event.app_user_id} | Resolved UUID: ${userId ?? "none"} | Env: ${environment}`);

  // Skip sandbox events unless explicitly allowed (e.g. staging / QA environments).
  // Set ALLOW_SANDBOX=true in the Supabase edge function env vars for staging.
  // Leave it unset (or false) in production to avoid polluting real subscriber data.
  const allowSandbox = Deno.env.get("ALLOW_SANDBOX") === "true";
  if (environment === "SANDBOX" && !allowSandbox) {
    console.log("[RC Webhook] Sandbox event — skipped (set ALLOW_SANDBOX=true to process)");
    return new Response(JSON.stringify({ received: true, skipped: "sandbox" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  // ── 3. Verify a Supabase UUID was found ────────────────────────────────────
  // Anonymous RC IDs ($RCAnonymousID:...) cannot be matched to a profile row.
  // Return 200 so RevenueCat stops retrying — there is nothing to update.
  if (!userId) {
    console.log(`[RC Webhook] No Supabase UUID resolvable from app_user_id: ${event.app_user_id} — skipping`);
    return new Response(JSON.stringify({ received: true, skipped: "unlinked_anonymous_user" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  // ── 4. Init Supabase admin client ──────────────────────────────────────────
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── 5. Handle event ────────────────────────────────────────────────────────

  try {
    if (type === "INITIAL_PURCHASE" || type === "RENEWAL" || type === "UNCANCELLATION") {
      // Subscription is (or became) active
      const planTier   = derivePlanTier(entitlement_ids, event.product_id);
      const expiryDate = epochToISO(expiration_at_ms);

      const { error } = await supabase
        .from("profiles")
        .update({
          plan_tier:                planTier,
          subscription_status:      "active",
          subscription_expiry_date: expiryDate,
          revenue_cat_customer_id:  event.app_user_id,
          updated_at:               new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (error) throw error;
      console.log(`[RC Webhook] ${type}: set plan_tier=${planTier}, status=active`);

    } else if (type === "CANCELLATION") {
      // Cancelled but still active until expiry_date — do NOT remove access yet
      const expiryDate = epochToISO(expiration_at_ms);

      const { error } = await supabase
        .from("profiles")
        .update({
          subscription_status:      "cancelled",
          subscription_expiry_date: expiryDate,
          updated_at:               new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (error) throw error;
      console.log(`[RC Webhook] CANCELLATION: status=cancelled, access until ${expiryDate}`);

    } else if (type === "EXPIRATION") {
      // Subscription has fully expired — remove access
      // Note: DB check constraint only allows 'active' | 'cancelled' | 'inactive'
      const { error } = await supabase
        .from("profiles")
        .update({
          subscription_status: "inactive",
          updated_at:          new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (error) throw error;
      console.log(`[RC Webhook] EXPIRATION: status=inactive`);

    } else if (type === "BILLING_ISSUE") {
      // Payment failed — restrict access
      // Note: DB check constraint only allows 'active' | 'cancelled' | 'inactive'
      const { error } = await supabase
        .from("profiles")
        .update({
          subscription_status: "inactive",
          updated_at:          new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (error) throw error;
      console.log(`[RC Webhook] BILLING_ISSUE: status=inactive`);

    } else if (type === "PRODUCT_CHANGE") {
      // User changed plan (upgrade/downgrade) — new product takes effect
      const newProductId = event.new_product_id ?? event.product_id;
      const planTier     = derivePlanTier(entitlement_ids, newProductId);
      const expiryDate   = epochToISO(expiration_at_ms);

      const { error } = await supabase
        .from("profiles")
        .update({
          plan_tier:                planTier,
          subscription_status:      "active",
          subscription_expiry_date: expiryDate,
          updated_at:               new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (error) throw error;
      console.log(`[RC Webhook] PRODUCT_CHANGE: new plan_tier=${planTier}`);

    } else if (type === "TEST") {
      console.log("[RC Webhook] TEST event received — no DB update");

    } else {
      // TRANSFER, SUBSCRIBER_ALIAS, etc. — log and ignore for now
      console.log(`[RC Webhook] Unhandled event type: ${type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (err: any) {
    const errMsg = err?.message ?? err?.details ?? JSON.stringify(err) ?? String(err);
    console.error("[RC Webhook] Error updating profiles:", errMsg, err);
    return new Response(JSON.stringify({ error: errMsg }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});
