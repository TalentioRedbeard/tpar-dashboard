// Server-side flag reads (data_flags — service-role via db(); RLS has zero
// policies by design). Writes live in lib/flag-actions.ts. Guide surface,
// never load-bearing: read failures degrade to empty lists.
import { db } from "./supabase";
import type { DataFlag } from "./flag-types";

/** Open + in-review flags for one entity, plus the last 14 days of outcomes —
 *  the flagger sees the resolution on the page they flagged from. */
export async function getFlagsForEntity(entityType: string, entityId: string): Promise<{
  live: DataFlag[];
  recent: DataFlag[];
}> {
  try {
    const supa = db();
    const [liveRes, recentRes] = await Promise.all([
      supa.from("data_flags").select("*")
        .eq("entity_type", entityType).eq("entity_id", entityId)
        .in("status", ["open", "in_review"])
        .order("created_at", { ascending: true }),
      supa.from("data_flags").select("*")
        .eq("entity_type", entityType).eq("entity_id", entityId)
        .in("status", ["resolved", "dismissed", "promoted"])
        .gte("resolved_at", new Date(Date.now() - 14 * 86400_000).toISOString())
        .order("resolved_at", { ascending: false })
        .limit(5),
    ]);
    return {
      live: (liveRes.data ?? []) as DataFlag[],
      recent: (recentRes.data ?? []) as DataFlag[],
    };
  } catch {
    return { live: [], recent: [] };
  }
}

/** The /manage/flags queue: everything alive, oldest first (queues display
 *  their own rot). */
export async function getOpenFlags(): Promise<DataFlag[]> {
  try {
    const { data } = await db()
      .from("data_flags").select("*")
      .in("status", ["open", "in_review"])
      .order("created_at", { ascending: true })
      .limit(500);
    return (data ?? []) as DataFlag[];
  } catch {
    return [];
  }
}
