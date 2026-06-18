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
      help={{
        intent:
          "Your personal preferences. Turn notifications and the GPS arrival/finish prompts on or off, hide the floating Record button, pick your schedule color, and choose which page you land on when you open the app. Everything here changes the app for you only.",
        actions: [
          "Toggle the teammate-note text and the automated end-of-day Slack review",
          "Turn the GPS arrival / finish prompts on or off (separate from your phone's location permission)",
          "Show or hide the floating quick-Record button",
          "Pick your schedule-board color and your default landing page",
        ],
        stuck:
          "Your sign-in, your name, and your role aren't editable here — those stay with Danny. In view-as mode, exit first to change your own settings.",
      }}
    >
      <SettingsForm initial={settings} leadership={leadership} />
    </PageShell>
  );
}
