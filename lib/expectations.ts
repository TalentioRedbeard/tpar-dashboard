// Daily expectations — read layer for the "My day" surface on /me.
// Leadership authors short daily tasks/reminders (see lib/expectations-actions.ts);
// each renders on an employee's dashboard scoped global / role / person.
// Table is tiny, so effective-date filtering is done in JS (avoids PostgREST
// null-OR gymnastics). Service-role read via db().

import { db } from "./supabase";
import type { DashboardRole } from "./current-tech";

export type Expectation = {
  id: string;
  title: string;
  detail: string | null;
  icon: string | null;
  category: string | null;
  scope_type: "global" | "role" | "person";
  scope_roles: string[];
  scope_person: string | null;
  link_href: string | null;
  link_label: string | null;
  sort_order: number;
  is_active: boolean;
  effective_from: string | null;
  effective_through: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function chicagoToday(): string {
  // YYYY-MM-DD in America/Chicago (en-CA gives ISO order)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Expectations that apply to a given employee right now: active, in their
// effective window, and matching global OR their role OR them by name.
export async function listDailyExpectations(techShortName: string | null, role: DashboardRole): Promise<Expectation[]> {
  // scope OR clause — global always; role clause only when we know the role;
  // person clause only when we know the tech name.
  const ors = ["scope_type.eq.global"];
  if (role) ors.push(`and(scope_type.eq.role,scope_roles.cs.{${role}})`);
  if (techShortName) ors.push(`and(scope_type.eq.person,scope_person.eq.${techShortName})`);

  const { data } = await db()
    .from("daily_expectations")
    .select("*")
    .eq("is_active", true)
    .or(ors.join(","))
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const today = chicagoToday();
  return ((data ?? []) as Expectation[]).filter(
    (e) => (!e.effective_from || e.effective_from <= today) && (!e.effective_through || e.effective_through >= today),
  );
}

// Every expectation (active + inactive), for the admin editor.
export async function listAllExpectations(): Promise<Expectation[]> {
  const { data } = await db()
    .from("daily_expectations")
    .select("*")
    .order("is_active", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []) as Expectation[];
}
