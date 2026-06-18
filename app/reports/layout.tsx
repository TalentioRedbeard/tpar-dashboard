// Route-group gate for ALL /reports/* pages (financial + PII: margin, AR, PIP,
// audit, per-tech performance). Previously each report self-gated and most did
// NOT — leaving them readable by any signed-in @tulsapar.com employee. Gating
// here makes admin-only the DEFAULT for the whole tree, so a new report page is
// protected by inheritance instead of relying on a per-page check that can be
// forgotten. (Verified exposure + fix 2026-05-31.)

import { type ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentTech } from "../../lib/current-tech";

export default async function ReportsLayout({ children }: { children: ReactNode }) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/reports");
  // Leadership (admin + manager) — managers (Kelsey/Madisson) get the financial/cost
  // reports too (Danny 2026-06-18: "Management and Admin should be able to access
  // receipts and/or job cost"). Matches the /reports index page + /admin/ar gates.
  if (!me.isAdmin && !me.isManager) redirect("/me");
  return <>{children}</>;
}
