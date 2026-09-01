import { resolvePublicSupabaseUrl } from "./resolvePublicSupabaseUrl.ts";

/**
 * Build a browser-reachable public Storage URL.
 * Same pattern as dashboard request attachments (`getPublicUrl` on a public
 * bucket), but uses PUBLIC_SUPABASE_URL_API so self-hosted edge runtimes that
 * talk to kong:8000 do not return internal hosts the phone cannot open.
 */
export function resolveStoragePublicUrl(bucket: string, path: string): string {
  const base = resolvePublicSupabaseUrl().replace(/\/$/, "");
  const clean = path.replace(/^\/+/, "");
  return `${base}/storage/v1/object/public/${bucket}/${clean}`;
}
