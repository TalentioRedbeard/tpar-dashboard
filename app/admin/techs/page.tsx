// Tech directory editor. Phase 3 Tier 3 (Danny-only by default).
// Edits propagate via the cached lookup pattern in slack-events / slack-receipt
// / slack-estimate within ~5 minutes — see project_tech_directory_slack_user_id.

import { redirect } from "next/navigation";
import { db } from "../../../lib/supabase";
import { getSessionUser } from "../../../lib/supabase-server";
import { isAdmin } from "../../../lib/admin";
import { PageShell } from "../../../components/PageShell";
import { TechRowForm } from "../../../components/TechRowForm";

export const metadata = { title: "Admin · Techs · TPAR-DB" };

type TechRow = {
  tech_id: string;
  tech_short_name: string;
  hcp_full_name: string | null;
  hcp_employee_id: string | null;
  is_active: boolean;
  slack_user_id: string | null;
  notes: string | null;
  updated_at: string | null;
};

export default async function AdminTechsPage() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) redirect("/");

  const supa = db();
  const { data, error } = await supa
    .from("tech_directory")
    .select("tech_id, tech_short_name, hcp_full_name, hcp_employee_id, is_active, slack_user_id, notes, updated_at")
    .order("is_active", { ascending: false })
    .order("tech_short_name");

  const rows = (data ?? []) as TechRow[];
  const active = rows.filter((r) => r.is_active);
  const inactive = rows.filter((r) => !r.is_active);

  return (
    <PageShell
      title="Tech directory"
      description={`${active.length} active · ${inactive.length} inactive · changes log to maintenance_logs source='admin-tech-edit'.`}
    >
      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Failed to load: {error.message}
        </div>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-800">Active</h2>
        {active.length === 0 ? (
          <p className="text-sm text-neutral-500">No active techs.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {active.map((r) => (
              <TechRowForm
                key={r.tech_id}
                techId={r.tech_id}
                techShortName={r.tech_short_name}
                hcpFullName={r.hcp_full_name}
                initialSlackUserId={r.slack_user_id}
                initialIsActive={r.is_active}
                initialNotes={r.notes}
              />
            ))}
          </div>
        )}
      </section>

      {inactive.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-neutral-500">Inactive</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 opacity-80">
            {inactive.map((r) => (
              <TechRowForm
                key={r.tech_id}
                techId={r.tech_id}
                techShortName={r.tech_short_name}
                hcpFullName={r.hcp_full_name}
                initialSlackUserId={r.slack_user_id}
                initialIsActive={r.is_active}
                initialNotes={r.notes}
              />
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-8 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <strong>Heads up:</strong> changes to <code>slack_user_id</code> propagate to{" "}
        <code>slack-events</code>, <code>slack-receipt</code>, <code>slack-estimate</code>,
        and <code>resolve-probable-job</code> within ~5 minutes (cache TTL).
        <code>tech_short_name</code> and <code>hcp_full_name</code> are HCP-derived
        and not editable here — fix in HCP and let the next sync flow through.
      </div>
    </PageShell>
  );
}
