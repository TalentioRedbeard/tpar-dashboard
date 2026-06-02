"use server";

// Phone-OTP login gate. Confirms a number belongs to an ACTIVE tech BEFORE the
// browser requests an SMS code — so strangers never get a text (and get a clear
// "not recognized" message instead). The actual OTP send + verify run on the
// browser client (which sets the session cookie); this only validates + returns
// the normalized E.164 to use.
import { db } from "@/lib/supabase";
import { toE164US } from "@/lib/phone";

export async function lookupTechByPhone(
  raw: string,
): Promise<{ ok: true; e164: string } | { ok: false; error: string }> {
  const e164 = toE164US(raw);
  if (!e164) return { ok: false, error: "Enter your 10-digit mobile number." };
  const { data, error } = await db()
    .from("tech_directory")
    .select("tech_id")
    .eq("phone", e164)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: "Couldn't check that number — try again." };
  if (!data) return { ok: false, error: "We don't recognize that number. Ask Danny or Madisson to add it." };
  return { ok: true, e164 };
}
