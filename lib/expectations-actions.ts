"use server";

// Daily-expectations authoring — owner-gated mutations behind /admin/expectations.
// Per Danny ("that's on me for creating + describing the tasks"), authoring is
// owner-only (requireOwner), distinct from broader admin. Reads are in
// lib/expectations.ts. Honors "system invites, never compels" — these are
// guidance shown on /me, not hard gates.

import { revalidatePath } from "next/cache";
import { db } from "./supabase";
import { requireOwner } from "./current-tech";

export type ExpectationInput = {
  id?: string;
  title: string;
  detail?: string | null;
  icon?: string | null;
  category?: string | null;
  scope_type: "global" | "role" | "person";
  scope_roles?: string[];
  scope_person?: string | null;
  link_href?: string | null;
  link_label?: string | null;
  sort_order?: number;
  effective_from?: string | null;
  effective_through?: string | null;
};

type Result = { ok: true; id: string } | { ok: false; error: string };

const clean = (s: unknown): string | null => {
  const t = String(s ?? "").trim();
  return t ? t : null;
};

export async function upsertExpectation(input: ExpectationInput): Promise<Result> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false, error: owner.error };

  const title = clean(input.title);
  if (!title) return { ok: false, error: "Title is required." };
  if (title.length > 200) return { ok: false, error: "Title too long (200 max)." };

  const scopeType = ["global", "role", "person"].includes(input.scope_type) ? input.scope_type : "global";
  const scopeRoles = scopeType === "role"
    ? (input.scope_roles ?? []).map((r) => String(r).trim()).filter((r) => ["admin", "manager", "production_manager", "tech"].includes(r))
    : [];
  const scopePerson = scopeType === "person" ? clean(input.scope_person) : null;
  if (scopeType === "role" && scopeRoles.length === 0) return { ok: false, error: "Pick at least one role." };
  if (scopeType === "person" && !scopePerson) return { ok: false, error: "Pick a person (tech short name)." };

  const row = {
    title,
    detail: clean(input.detail),
    icon: clean(input.icon),
    category: clean(input.category),
    scope_type: scopeType,
    scope_roles: scopeRoles,
    scope_person: scopePerson,
    link_href: clean(input.link_href),
    link_label: clean(input.link_label),
    sort_order: Number.isFinite(input.sort_order) ? Number(input.sort_order) : 100,
    effective_from: clean(input.effective_from),
    effective_through: clean(input.effective_through),
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data, error } = await db().from("daily_expectations").update(row).eq("id", input.id).select("id").single();
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/expectations");
    revalidatePath("/me");
    return { ok: true, id: (data as { id: string }).id };
  }

  const { data, error } = await db()
    .from("daily_expectations")
    .insert({ ...row, created_by: owner.email })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/expectations");
  revalidatePath("/me");
  return { ok: true, id: (data as { id: string }).id };
}

export async function setExpectationActive(id: string, active: boolean): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false, error: owner.error };
  const { error } = await db().from("daily_expectations").update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/expectations");
  revalidatePath("/me");
  return { ok: true };
}

export async function deleteExpectation(id: string): Promise<{ ok: boolean; error?: string }> {
  const owner = await requireOwner();
  if (!owner.ok) return { ok: false, error: owner.error };
  const { error } = await db().from("daily_expectations").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/expectations");
  revalidatePath("/me");
  return { ok: true };
}
