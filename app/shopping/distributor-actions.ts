"use server";

// Distributor directory for the Shopping page. Read by any signed-in tech;
// edit/add/remove gated to admins. The order-email + can_email_order fields
// drive the per-vendor "email order/quote" mailto action in the UI.

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { revalidatePath } from "next/cache";

export type Distributor = {
  id: string;
  name: string;
  vendorKey: string | null;
  category: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  orderEmail: string | null;
  accountNumber: string | null;
  address: string | null;
  website: string | null;
  notes: string | null;
  canEmailOrder: boolean;
  sortOrder: number;
};

const COLS =
  "id, name, vendor_key, category, contact_name, phone, email, order_email, account_number, address, website, notes, can_email_order, sort_order";

function mapRow(r: Record<string, unknown>): Distributor {
  return {
    id: r.id as string,
    name: r.name as string,
    vendorKey: (r.vendor_key as string) ?? null,
    category: (r.category as string) ?? null,
    contactName: (r.contact_name as string) ?? null,
    phone: (r.phone as string) ?? null,
    email: (r.email as string) ?? null,
    orderEmail: (r.order_email as string) ?? null,
    accountNumber: (r.account_number as string) ?? null,
    address: (r.address as string) ?? null,
    website: (r.website as string) ?? null,
    notes: (r.notes as string) ?? null,
    canEmailOrder: !!r.can_email_order,
    sortOrder: (r.sort_order as number) ?? 100,
  };
}

export async function listDistributors(): Promise<Distributor[]> {
  const me = await getCurrentTech().catch(() => null);
  if (!me) return [];
  const { data } = await db()
    .from("distributors")
    .select(COLS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return ((data ?? []) as Array<Record<string, unknown>>).map(mapRow);
}

export type DistributorInput = {
  id?: string;
  name: string;
  category?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  orderEmail?: string | null;
  accountNumber?: string | null;
  address?: string | null;
  website?: string | null;
  notes?: string | null;
  canEmailOrder?: boolean;
  sortOrder?: number;
};

export async function upsertDistributor(input: DistributorInput): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech().catch(() => null);
  if (!me?.isAdmin) return { ok: false, error: "Only admins can edit distributors." };
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "Name is required." };

  const row: Record<string, unknown> = {
    name,
    category: input.category?.trim() || null,
    contact_name: input.contactName?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    order_email: input.orderEmail?.trim() || null,
    account_number: input.accountNumber?.trim() || null,
    address: input.address?.trim() || null,
    website: input.website?.trim() || null,
    notes: input.notes?.trim() || null,
    can_email_order: !!input.canEmailOrder,
    sort_order: input.sortOrder ?? 100,
    updated_at: new Date().toISOString(),
  };

  const supa = db();
  const { error } = input.id
    ? await supa.from("distributors").update(row).eq("id", input.id)
    : await supa.from("distributors").insert(row);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/shopping");
  return { ok: true };
}

export async function deleteDistributor(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentTech().catch(() => null);
  if (!me?.isAdmin) return { ok: false, error: "Only admins can remove distributors." };
  // Soft-delete: keep the row (and its vendor_key link) for history.
  await db().from("distributors").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/shopping");
  return { ok: true };
}
