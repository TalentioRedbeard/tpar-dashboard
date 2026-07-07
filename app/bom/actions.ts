"use server";

// Server actions behind /bom — the Service → Parts (bill of materials) review
// surface. An LLM/heuristic generator drafts BOMs into service_boms
// (status='pending') + service_bom_lines; the owner reviews, edits lines, and
// approves here. Approved BOMs feed the deterministic materials estimate
// (service_material_estimate RPC) surfaced in the estimate builder.
//
// Owner-gated (same isAdmin gate as /conversation + /context). Line edits are
// only allowed while a BOM is still pending — once approved it's locked so the
// estimate spine reads a stable definition. All actions revalidate /bom.

import { db } from "@/lib/supabase";
import { getSessionUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { revalidatePath } from "next/cache";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type CanonicalHit = { id: number; canonical_name: string; size: string | null; category: string | null };

async function requireOwner(): Promise<{ email: string } | null> {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.email)) return null;
  return { email: user.email ?? "owner" };
}

// Confirm a line's parent BOM is still pending (line edits are pre-approval only).
// Returns the bom_id on success, or an error string.
async function pendingBomForLine(lineId: string): Promise<{ ok: true; bomId: string } | { ok: false; error: string }> {
  const supa = db();
  const { data: line, error: lineErr } = await supa
    .from("service_bom_lines")
    .select("bom_id")
    .eq("id", lineId)
    .maybeSingle();
  if (lineErr) return { ok: false, error: lineErr.message };
  if (!line) return { ok: false, error: "line not found" };
  const bomId = (line as { bom_id: string }).bom_id;
  const { data: bom, error: bomErr } = await supa
    .from("service_boms")
    .select("status")
    .eq("id", bomId)
    .maybeSingle();
  if (bomErr) return { ok: false, error: bomErr.message };
  if (!bom) return { ok: false, error: "BOM not found" };
  if ((bom as { status: string }).status !== "pending") {
    return { ok: false, error: "BOM is approved — lines are locked. Reject it first to edit." };
  }
  return { ok: true, bomId };
}

export async function approveBom(bomId: string): Promise<ActionResult> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "owner only" };
  if (!bomId) return { ok: false, error: "missing BOM id" };
  const nowIso = new Date().toISOString();
  const { error } = await db()
    .from("service_boms")
    .update({ status: "approved", reviewed_at: nowIso, reviewed_by: user.email, updated_at: nowIso })
    .eq("id", bomId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/bom");
  return { ok: true };
}

export async function rejectBom(bomId: string): Promise<ActionResult> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "owner only" };
  if (!bomId) return { ok: false, error: "missing BOM id" };
  const nowIso = new Date().toISOString();
  const { error } = await db()
    .from("service_boms")
    .update({ status: "rejected", reviewed_at: nowIso, reviewed_by: user.email, updated_at: nowIso })
    .eq("id", bomId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/bom");
  return { ok: true };
}

export async function addBomLine(input: {
  bomId: string;
  partName: string;
  qty: number;
  optional: boolean;
  canonicalItemId?: number | null;
}): Promise<ActionResult> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "owner only" };
  const partName = (input.partName ?? "").trim();
  if (!input.bomId) return { ok: false, error: "missing BOM id" };
  if (!partName) return { ok: false, error: "part name is required" };
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "quantity must be greater than 0" };

  const supa = db();
  const { data: bom, error: bomErr } = await supa
    .from("service_boms")
    .select("status")
    .eq("id", input.bomId)
    .maybeSingle();
  if (bomErr) return { ok: false, error: bomErr.message };
  if (!bom) return { ok: false, error: "BOM not found" };
  if ((bom as { status: string }).status !== "pending") {
    return { ok: false, error: "BOM is approved — lines are locked. Reject it first to edit." };
  }

  const { error } = await supa.from("service_bom_lines").insert({
    bom_id: input.bomId,
    part_name: partName.slice(0, 300),
    qty,
    optional: !!input.optional,
    canonical_item_id: input.canonicalItemId ?? null,
    basis: "manual",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/bom");
  return { ok: true };
}

export async function removeBomLine(lineId: string): Promise<ActionResult> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "owner only" };
  if (!lineId) return { ok: false, error: "missing line id" };
  const guard = await pendingBomForLine(lineId);
  if (!guard.ok) return guard;
  const { error } = await db().from("service_bom_lines").delete().eq("id", lineId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/bom");
  return { ok: true };
}

// Match (or clear, with null) a line to a canonical_items row so it gets priced.
export async function matchBomLine(lineId: string, canonicalItemId: number | null): Promise<ActionResult> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "owner only" };
  if (!lineId) return { ok: false, error: "missing line id" };
  const guard = await pendingBomForLine(lineId);
  if (!guard.ok) return guard;
  const { error } = await db()
    .from("service_bom_lines")
    .update({ canonical_item_id: canonicalItemId ?? null })
    .eq("id", lineId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/bom");
  return { ok: true };
}

// Catalog search for the match / add-line pickers.
export async function searchCanonicalItems(term: string): Promise<CanonicalHit[]> {
  if (!(await requireOwner())) return [];
  const t = (term ?? "").trim();
  if (t.length < 2) return [];
  const like = `%${t.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const { data } = await db()
    .from("canonical_items")
    .select("id, canonical_name, size, category")
    .ilike("canonical_name", like)
    .order("canonical_name", { ascending: true })
    .limit(12);
  return ((data ?? []) as Array<{ id: number; canonical_name: string | null; size: string | null; category: string | null }>).map((r) => ({
    id: r.id,
    canonical_name: r.canonical_name ?? `#${r.id}`,
    size: r.size,
    category: r.category,
  }));
}
