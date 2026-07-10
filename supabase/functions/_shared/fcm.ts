// ─────────────────────────────────────────────────────────────────────────────
// Firebase Cloud Messaging (HTTP v1) helper.
//
// Unified push path for iOS and Android. Reads a Google service-account JSON
// from the FCM_SERVICE_ACCOUNT_JSON secret, mints a short-lived OAuth2 access
// token (RS256-signed JWT), and sends notifications via the FCM v1 API.
//
// Tokens that FCM reports as UNREGISTERED / invalid are returned to the caller
// so they can be marked is_active = false in employee_device_tokens.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface PushMessage {
  title: string;
  body: string;
  /** Optional key/value data payload. All values must be strings for FCM. */
  data?: Record<string, string>;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
  project_id: string;
}

// Module-level cache for the OAuth2 access token (valid ~1 hour).
let cachedAccessToken: string | null = null;
let cachedTokenExpiresAt = 0;

export function clearFcmTokenCache(): void {
  cachedAccessToken = null;
  cachedTokenExpiresAt = 0;
}

function loadServiceAccount(): ServiceAccount {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!raw) {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON secret is not configured");
  }

  // Accept either raw JSON ({...}) or a base64-encoded JSON blob (easier to
  // store in a .env file, since the private key spans multiple lines).
  const trimmed = raw.trim();
  let jsonText = trimmed;
  if (!trimmed.startsWith("{")) {
    try {
      jsonText = atob(trimmed);
    } catch {
      throw new Error("FCM_SERVICE_ACCOUNT_JSON is neither JSON nor valid base64");
    }
  }

  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON is missing required fields");
  }
  return parsed;
}

// ── Base64url helpers ─────────────────────────────────────────────────────────
function base64urlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ── Mint (and cache) an OAuth2 access token via signed JWT ─────────────────────
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // Reuse cached token if it still has >60s of life.
  if (cachedAccessToken && now < cachedTokenExpiresAt - 60) {
    return cachedAccessToken;
  }

  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64urlEncode(JSON.stringify(header))}.${base64urlEncode(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );

  const jwt = `${unsigned}.${base64urlEncode(new Uint8Array(signature))}`;

  const resp = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const json = await resp.json();
  if (!resp.ok || !json.access_token) {
    clearFcmTokenCache();
    throw new Error(`Failed to obtain FCM access token: ${JSON.stringify(json)}`);
  }

  const accessToken = String(json.access_token).trim();
  if (!accessToken) {
    clearFcmTokenCache();
    throw new Error("FCM OAuth returned an empty access_token");
  }

  cachedAccessToken = accessToken;
  cachedTokenExpiresAt = now + Number(json.expires_in ?? 3600);
  console.log(`FCM OAuth token acquired (len=${accessToken.length}, expires_in=${json.expires_in ?? 3600})`);
  return cachedAccessToken;
}

// ── Send to a set of raw tokens ───────────────────────────────────────────────
export interface SendResult {
  successCount: number;
  /** Tokens FCM reported as permanently invalid (should be deactivated). */
  invalidTokens: string[];
}

export async function sendFcmToTokens(
  tokens: string[],
  message: PushMessage,
): Promise<SendResult> {
  const result: SendResult = { successCount: 0, invalidTokens: [] };
  if (tokens.length === 0) return result;

  const sa = loadServiceAccount();
  const accessToken = await getAccessToken(sa);
  if (!accessToken) {
    throw new Error("FCM access token is empty before send");
  }
  const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

  await Promise.all(
    tokens.map(async (token) => {
      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: message.title, body: message.body },
              ...(message.data ? { data: message.data } : {}),
            },
          }),
        });

        if (resp.ok) {
          result.successCount++;
          return;
        }

        const err = await resp.json().catch(() => ({}));
        const status = err?.error?.status ?? "";
        const detail = err?.error?.message ?? JSON.stringify(err);
        if (resp.status === 401) {
          clearFcmTokenCache();
        }
        // UNREGISTERED = token no longer valid; INVALID_ARGUMENT on the token = malformed.
        if (status === "UNREGISTERED" || status === "NOT_FOUND" || resp.status === 404) {
          result.invalidTokens.push(token);
        }
        console.error(
          `FCM send failed (${resp.status} ${status}) for token ${token.slice(0, 12)}… — ${detail}`,
        );
      } catch (e) {
        console.error("FCM send exception:", e);
      }
    }),
  );

  return result;
}

// ── Send to one or more employees (reads their active tokens) ─────────────────
export interface EmployeePushResult {
  /** Employee IDs that had at least one active token AND got a successful send. */
  notifiedEmployeeIds: string[];
  /** Employee IDs with no active push token (caller may fall back to SMS). */
  employeesWithoutToken: string[];
}

export async function sendPushToEmployees(
  supabase: SupabaseClient,
  employeeIds: string[],
  message: PushMessage,
): Promise<EmployeePushResult> {
  const out: EmployeePushResult = { notifiedEmployeeIds: [], employeesWithoutToken: [] };
  if (employeeIds.length === 0) return out;

  const { data: tokenRows } = await supabase
    .from("employee_device_tokens")
    .select("id, employee_id, token")
    .in("employee_id", employeeIds)
    .eq("is_active", true);
  return await deliverGrouped(supabase, employeeIds, tokenRows, "employee_id", message, out);
}

// ── Send to one or more owners / auth users (reads their active tokens) ────────
export interface UserPushResult {
  notifiedUserIds: string[];
  usersWithoutToken: string[];
}

export async function sendPushToUsers(
  supabase: SupabaseClient,
  userIds: string[],
  message: PushMessage,
): Promise<UserPushResult> {
  const out = { notifiedEmployeeIds: [], employeesWithoutToken: [] } as EmployeePushResult;
  if (userIds.length === 0) return { notifiedUserIds: [], usersWithoutToken: [] };

  const { data: tokenRows } = await supabase
    .from("user_device_tokens")
    .select("id, user_id, token")
    .in("user_id", userIds)
    .eq("is_active", true);

  const result = await deliverGrouped(supabase, userIds, tokenRows, "user_id", message, out, "user_device_tokens");
  return { notifiedUserIds: result.notifiedEmployeeIds, usersWithoutToken: result.employeesWithoutToken };
}

// Shared delivery routine for a set of entity IDs and their token rows.
async function deliverGrouped(
  supabase: SupabaseClient,
  ids: string[],
  tokenRows: unknown,
  idKey: "employee_id" | "user_id",
  message: PushMessage,
  out: EmployeePushResult,
  tokenTable: "employee_device_tokens" | "user_device_tokens" = "employee_device_tokens",
): Promise<EmployeePushResult> {
  const tokensById = new Map<string, string[]>();
  for (const row of (tokenRows ?? []) as Record<string, string>[]) {
    const entityId = row[idKey];
    const list = tokensById.get(entityId) ?? [];
    list.push(row.token);
    tokensById.set(entityId, list);
  }

  const allInvalidTokens: string[] = [];

  for (const id of ids) {
    const tokens = tokensById.get(id);
    if (!tokens || tokens.length === 0) {
      out.employeesWithoutToken.push(id);
      continue;
    }

    const res = await sendFcmToTokens(tokens, message);
    allInvalidTokens.push(...res.invalidTokens);

    // Consider the entity notified if any token succeeded; otherwise fall back.
    if (res.successCount > 0) {
      out.notifiedEmployeeIds.push(id);
    } else {
      out.employeesWithoutToken.push(id);
    }
  }

  // Deactivate tokens FCM reported as invalid.
  if (allInvalidTokens.length > 0) {
    await supabase
      .from(tokenTable)
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in("token", allInvalidTokens);
  }

  return out;
}

/** Diagnostic helper — tests env parsing + OAuth without sending a push. */
export async function diagnoseFcmCredentials(): Promise<Record<string, unknown>> {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") ?? "";
  const out: Record<string, unknown> = {
    env_configured: raw.length > 0,
    env_length: raw.length,
  };
  try {
    const sa = loadServiceAccount();
    out.project_id = sa.project_id;
    out.client_email = sa.client_email;
    out.private_key_length = sa.private_key?.length ?? 0;
    clearFcmTokenCache();
    const token = await getAccessToken(sa);
    out.oauth_ok = true;
    out.access_token_length = token.length;
    out.access_token_prefix = token.slice(0, 12);

    // Probe FCM with a dummy token — 400 INVALID_ARGUMENT means OAuth worked; 401 means auth failed.
    const probe = await fetch(
      `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: "probe-token-invalid",
            notification: { title: "probe", body: "probe" },
          },
        }),
      },
    );
    const probeJson = await probe.json().catch(() => ({}));
    out.fcm_probe_status = probe.status;
    out.fcm_probe_error = probeJson?.error?.status ?? null;
    out.fcm_probe_message = probeJson?.error?.message ?? null;
  } catch (e) {
    out.oauth_ok = false;
    out.oauth_error = e instanceof Error ? e.message : String(e);
  }
  return out;
}
