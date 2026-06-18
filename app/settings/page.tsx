// /settings — per-user preferences. Any signed-in person with a tech profile can
// edit their OWN settings (managers included — uses requireSelf, not requireWriter).
// Owner sees an extra global-controls section. Writes are scoped by tech_id in
// lib/settings-actions.ts (the only ownership boundary; no RLS).

import { redirect } from "next/navigation";
import { getCurrentTech } from "@/lib/current-tech";
import { getMySettings } from "@/lib/settings-actions";
import { PageShell } from "@/components/PageShell";
import { SettingsForm } from "@/components/SettingsForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · TPAR-DB" };

export default async function SettingsPage() {
  const me = await getCurrentTech().catch(() => null);
  if (!me) redirect("/login?from=/settings");
  const settings = await getMySettings();
  if (!settings) redirect("/login?from=/settings");
  const leadership = me.isAdmin || me.isManager;

  return (
    <PageShell
      kicker="Account"
      title="Settings"
      description="Your preferences — notifications, field prompts, and display. Changes apply only to you."
      hideAskBar
    >
      <SettingsForm initial={settings} leadership={leadership} />
    </PageShell>
  );
}
