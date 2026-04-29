// Server-side Supabase client. Uses service_role for unrestricted read access
// to job_360 / customer_360 / communication_events. NEVER import this from a
// client component — service_role bypasses RLS.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  // In dev surfacing this fast is more useful than a confusing runtime error
  // eslint-disable-next-line no-console
  console.warn("[lib/supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — set in .env.local");
}

let _client: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _client;
}
