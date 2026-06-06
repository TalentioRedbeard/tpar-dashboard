// /admin/expectations — owner surface to author the daily expectations that
// render on each employee's /me "My day" panel. Gated to admin (Danny);
// mutations are owner-gated in lib/expectations-actions.

import { redirect } from "next/navigation";
import { PageShell } from "../../../components/PageShell";
import { ExpectationsAdmin } from "../../../components/ExpectationsAdmin";
import { getCurrentTech } from "../../../lib/current-tech";
import { listAllExpectations } from "../../../lib/expectations";
import { db } from "../../../lib/supabase";

export const metadata = { title: "Daily expectations · TPAR-DB" };
export const dynamic = "force-dynamic";

export default async function ExpectationsAdminPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/admin/expectations");
  if (!me.isAdmin) redirect("/me");

  const [items, techRes] = await Promise.all([
    listAllExpectations(),
    db().from("tech_directory").select("tech_short_name").eq("is_active", true).order("tech_short_name"),
  ]);
  const techNames = ((techRes.data ?? []) as Array<{ tech_short_name: string }>).map((t) => t.tech_short_name).filter(Boolean);

  return (
    <PageShell
      kicker="Admin"
      title="Daily expectations"
      description="Short daily tasks + reminders that show on each employee's “My day” page. Scope each one to everyone, a role, or one person. Guidance — not a hard gate."
      backHref="/admin"
      backLabel="Admin home"
      hideAskBar
    >
      <ExpectationsAdmin items={items} techNames={techNames} />
    </PageShell>
  );
}
