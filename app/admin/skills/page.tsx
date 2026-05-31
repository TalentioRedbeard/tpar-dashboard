// Skills & requirements admin (#9). Author the skill catalog, per-tech grants,
// and per-work-type required skills. Admin-gated (mirrors /admin/techs).

import { redirect } from "next/navigation";
import { db } from "../../../lib/supabase";
import { getSessionUser } from "../../../lib/supabase-server";
import { isAdmin } from "../../../lib/admin";
import { PageShell } from "../../../components/PageShell";
import { listSkills, listTechSkills, listWorkTypeRequirements } from "../../../lib/skills";
import { SkillsAdmin } from "../../../components/SkillsAdmin";

export const metadata = { title: "Admin · Skills · TPAR-DB" };

export default async function AdminSkillsPage() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) redirect("/");

  const [skills, techSkills, workReqs, techsRes] = await Promise.all([
    listSkills(true),
    listTechSkills(),
    listWorkTypeRequirements(),
    db().from("tech_directory")
      .select("tech_id, tech_short_name, hcp_full_name")
      .eq("is_active", true).neq("is_test", true)
      .in("dashboard_role", ["tech", "admin"])
      .order("tech_short_name"),
  ]);
  const techs = (techsRes.data ?? []) as Array<{ tech_id: string; tech_short_name: string; hcp_full_name: string | null }>;

  return (
    <PageShell
      title="Skills & requirements"
      description="The structured skillset layer (#9): author the catalog, grant skills to techs, and define what each work type requires. Feeds the scheduling advisor + task assignment."
    >
      <SkillsAdmin skills={skills} techs={techs} techSkills={techSkills} workReqs={workReqs} />
    </PageShell>
  );
}
