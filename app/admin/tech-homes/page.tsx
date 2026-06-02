// /admin/tech-homes (#26) — owner-only entry of tech home addresses (PII).
// Geocoded on save; used ONLY to derive van-home proximity for the GPS window
// (dispatch sees distance, never the address). Owner-gated (Danny alone).

import { redirect } from "next/navigation";
import { getSessionUser } from "../../../lib/supabase-server";
import { isOwner } from "../../../lib/admin";
import { PageShell } from "../../../components/PageShell";
import { Section } from "../../../components/ui/Section";
import { listTechHomes } from "../../../lib/tech-home-actions";
import { TechHomeForm } from "../../../components/TechHomeForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tech Homes · Admin · TPAR-DB" };

export default async function TechHomesPage() {
  const user = await getSessionUser();
  if (!user || !isOwner(user.email)) redirect("/");
  const techs = await listTechHomes();

  return (
    <PageShell
      kicker="Admin · Owner"
      title="Tech home addresses"
      description="🔒 Owner-only PII. Used only to answer “did a tech drive the van home” in the GPS window — dispatch sees distance-from-home, never the address."
      backHref="/reports"
      backLabel="Reports"
    >
      <Section title="Set / update home (geocoded on save)">
        {techs.length === 0 ? (
          <p className="text-sm text-neutral-500">No active techs found.</p>
        ) : (
          <div className="space-y-2">
            {techs.map((t) => <TechHomeForm key={t.tech_id} tech={t} />)}
          </div>
        )}
        <p className="mt-3 text-xs text-neutral-500">
          Clear the box and Save to remove a home. Saving geocodes via Google; if a match looks wrong, clear and re-enter a more specific address.
        </p>
      </Section>
    </PageShell>
  );
}
