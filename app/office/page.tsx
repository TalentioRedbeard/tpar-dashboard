// /office — the obligations board. Buckets: overdue · this week · this month ·
// scheduled · needs-a-date · paused. Completing an event advances the cadence
// (deterministic SQL, not model math) and files the evidence note.

import { getBoard } from "@/lib/office/actions";
import { OfficeBoard } from "./OfficeBoard";

export const dynamic = "force-dynamic";

export default async function OfficePage() {
  const res = await getBoard();
  if (!res.ok) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">{res.error}</div>;
  }
  return <OfficeBoard rows={res.rows} />;
}
