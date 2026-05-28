"use server";

// Server actions for the owner-editable "?" help bubble. getPageHelp reads the
// DB override for the current route (any signed-in user); savePageHelp upserts
// it (owner only, enforced by requireOwner). Both normalize the path so dynamic
// routes share one entry.

import { db } from "../../lib/supabase";
import { getSessionUser } from "../../lib/supabase-server";
import { requireOwner } from "../../lib/current-tech";
import { helpKeyForPath } from "../../lib/help-key";

export type PageHelpData = {
  intent: string;
  actions: string[];
  stuck: string | null;
};

export async function getPageHelp(pathname: string): Promise<PageHelpData | null> {
  // Require a session so this action isn't an open read endpoint, but any
  // signed-in user may read help content.
  const user = await getSessionUser();
  if (!user) return null;

  const key = helpKeyForPath(pathname);
  const { data } = await db()
    .from("page_help")
    .select("intent, actions, stuck")
    .eq("path", key)
    .maybeSingle();
  if (!data) return null;
  return {
    intent: (data.intent as string) ?? "",
    actions: (data.actions as string[] | null) ?? [],
    stuck: (data.stuck as string | null) ?? null,
  };
}

export async function savePageHelp(
  pathname: string,
  content: PageHelpData,
): Promise<{ ok: boolean; error?: string; key?: string }> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false, error: owner.error };

  const intent = (content.intent ?? "").trim();
  if (!intent) return { ok: false, error: "The one-line description can't be empty." };

  const key = helpKeyForPath(pathname);
  const actions = (content.actions ?? []).map((a) => a.trim()).filter(Boolean);
  const stuck = content.stuck && content.stuck.trim() ? content.stuck.trim() : null;

  const { error } = await db()
    .from("page_help")
    .upsert(
      { path: key, intent, actions, stuck, updated_by: owner.email, updated_at: new Date().toISOString() },
      { onConflict: "path" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true, key };
}
