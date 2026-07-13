// EntityFlags — the closed loop of the flag mechanism: live flags on this
// entity, plus recent outcomes credited by name, ON the page where they were
// raised (the tech-adoption loop: you flagged it, you see it got handled).
// Server component; renders nothing when there is nothing to say.

import { getFlagsForEntity } from "../lib/flags";
import { flagTypeMeta } from "../lib/flag-types";

function ageDays(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  return d === 0 ? "today" : `${d}d ago`;
}
const who = (email: string | null) => (email ?? "?").split("@")[0];

export async function EntityFlags({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { live, recent } = await getFlagsForEntity(entityType, entityId);
  if (live.length === 0 && recent.length === 0) return null;

  return (
    <section className="mb-4 space-y-1.5">
      {live.map((f) => {
        const meta = flagTypeMeta(f.flag_type);
        return (
          <div key={f.id} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
            <span aria-hidden>{meta.emoji}</span>
            <span className="min-w-0 flex-1">
              <span className="font-semibold text-amber-900">{meta.label}</span>
              <span className="text-amber-900"> — {f.note}</span>
              <span className="ml-1 text-xs text-amber-700">
                ({who(f.created_by)}, {ageDays(f.created_at)}
                {f.status === "in_review" ? " · with Danny" : ""})
              </span>
            </span>
          </div>
        );
      })}
      {recent.map((f) => {
        const meta = flagTypeMeta(f.flag_type);
        return (
          <div key={f.id} className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm">
            <span aria-hidden>✅</span>
            <span className="min-w-0 flex-1 text-emerald-900">
              <span className="font-semibold">{meta.label}</span> flag by {who(f.created_by)} —{" "}
              {f.status === "promoted" ? "made into a task" : f.resolution_note ?? f.status} ({who(f.resolved_by)},{" "}
              {f.resolved_at ? ageDays(f.resolved_at) : ""})
            </span>
          </div>
        );
      })}
    </section>
  );
}
