// Route-group gate for ALL /manage/* pages — the management control panel
// (Madisson + Kelsey day one; build plan 2026-07-13, section 2.1). Gating here
// makes management-only the DEFAULT for the whole tree so a new queue page is
// protected by inheritance (the /reports lesson, 2026-05-31). View-as needs no
// special case: impersonation downgrades the session to 'tech', which fails
// this check — /manage vanishes while viewing-as. Every MUTATING server action
// under /manage must additionally call requireManagement() itself (server
// actions self-authorize — the gallery lesson).

import { type ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentTech } from "../../lib/current-tech";

export default async function ManageLayout({ children }: { children: ReactNode }) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/manage");
  if (!me.isAdmin && !me.isManager) redirect("/me");
  return <>{children}</>;
}
