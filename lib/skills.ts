"use server";

// Structured skillset layer (#9, Danny 2026-05-31). Reads + owner/admin authoring
// for the skills catalog, per-tech grants, and per-work-type required skills.
// Consumed by the schedule advisor (fleet-gather) + the tech home + (next) task
// assignment hints. Authoring is admin-gated (mirrors /admin/techs).

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type Skill = { id: string; slug: string; label: string; category: string | null; description: string | null; is_active: boolean };
export type TechSkill = { tech_id: string; tech_short_name: string; skill_id: string; slug: string; label: string; level: string };
export type WorkTypeReq = { id: string; work_type: string; skill_id: string; required: boolean; min_level: string | null };
type Res = { ok: boolean; error?: string };

async function admin(): Promise<{ name: string } | { error: string }> {
  const me = await getCurrentTech();
  if (!me) return { error: "not signed in" };
  if (!me.isAdmin) return { error: "admin only" };
  return { name: me.tech?.tech_short_name ?? me.email };
}

// ── Reads ──
export async function listSkills(includeInactive = false): Promise<Skill[]> {
  let q = db().from("skills").select("id, slug, label, category, description, is_active").order("category", { ascending: true }).order("label", { ascending: true });
  if (!includeInactive) q = q.eq("is_active", true);
  const { data } = await q;
  return (data ?? []) as Skill[];
}

export async function listTechSkills(): Promise<TechSkill[]> {
  const { data } = await db().from("tech_skills_v").select("tech_id, tech_short_name, skill_id, slug, label, level").eq("is_active", true);
  return (data ?? []) as TechSkill[];
}

export async function listWorkTypeRequirements(): Promise<WorkTypeReq[]> {
  const { data } = await db().from("work_type_requirements").select("id, work_type, skill_id, required, min_level").order("work_type", { ascending: true });
  return (data ?? []) as WorkTypeReq[];
}

export async function listMySkills(): Promise<TechSkill[]> {
  const me = await getCurrentTech();
  if (!me?.tech) return [];
  const { data } = await db().from("tech_skills_v").select("tech_id, tech_short_name, skill_id, slug, label, level").eq("tech_short_name", me.tech.tech_short_name);
  return (data ?? []) as TechSkill[];
}

// ── Authoring (admin) ──
export async function createSkill(input: { slug: string; label: string; category?: string }): Promise<Res> {
  const g = await admin(); if ("error" in g) return { ok: false, error: g.error };
  const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const label = input.label.trim();
  if (!slug || !label) return { ok: false, error: "slug + label required" };
  const { error } = await db().from("skills").insert({ slug, label: label.slice(0, 120), category: input.category?.trim() || null });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/skills");
  return { ok: true };
}

export async function setSkillActive(id: string, is_active: boolean): Promise<Res> {
  const g = await admin(); if ("error" in g) return { ok: false, error: g.error };
  const { error } = await db().from("skills").update({ is_active, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/skills");
  return { ok: true };
}

export async function grantTechSkill(tech_id: string, skill_id: string, level = "proficient"): Promise<Res> {
  const g = await admin(); if ("error" in g) return { ok: false, error: g.error };
  const { error } = await db().from("tech_skills").upsert({ tech_id, skill_id, level, granted_by: g.name, granted_at: new Date().toISOString() }, { onConflict: "tech_id,skill_id" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/skills");
  return { ok: true };
}

export async function revokeTechSkill(tech_id: string, skill_id: string): Promise<Res> {
  const g = await admin(); if ("error" in g) return { ok: false, error: g.error };
  const { error } = await db().from("tech_skills").delete().eq("tech_id", tech_id).eq("skill_id", skill_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/skills");
  return { ok: true };
}

export async function setWorkTypeRequirement(work_type: string, skill_id: string, required: boolean, on: boolean): Promise<Res> {
  const g = await admin(); if ("error" in g) return { ok: false, error: g.error };
  const wt = work_type.trim();
  if (!wt || !skill_id) return { ok: false, error: "work type + skill required" };
  if (on) {
    const { error } = await db().from("work_type_requirements").upsert({ work_type: wt, skill_id, required }, { onConflict: "work_type,skill_id" });
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await db().from("work_type_requirements").delete().eq("work_type", wt).eq("skill_id", skill_id);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/admin/skills");
  return { ok: true };
}
