// THE canonical tech work-scope rule (Danny, 2026-07-16): a technician can
// see every customer, job, and estimate that pertains to work they were ON —
// full history, and being crew counts exactly as much as being the lead.
//
// Mechanics: match by hcp_employee_id (never names — the second-Chris
// collision) against the UNION of
//   1. jobs_master.assigned_employees   (job-level crew; history to 2021)
//   2. appointments_master.tech_all_ids (dispatch-level crew; history to 2024-06)
// Either arm passes. jobs_master goes back further; appointments catch crew
// who ride the appointment but never land on the job record. NEVER gate on
// job_360 — it is a ~350-row windowed subset (Landon lockout, 7/16).
//
// Fail CLOSED: no employee id, or no match → false.

import { db } from "@/lib/supabase";
import { assignedHasEmployee } from "@/lib/assigned-employees";

export async function techWorkedJob(
  empId: string | null | undefined,
  hcpJobId: string,
): Promise<boolean> {
  if (!empId || !hcpJobId) return false;
  const supa = db();
  const { data: jm } = await supa
    .from("jobs_master")
    .select("assigned_employees")
    .eq("hcp_job_id", hcpJobId)
    .maybeSingle();
  if (jm && assignedHasEmployee(jm.assigned_employees as string | null, empId)) return true;
  const { data: appt } = await supa
    .from("appointments_master")
    .select("id")
    .eq("hcp_job_id", hcpJobId)
    .contains("tech_all_ids", [empId])
    .limit(1)
    .maybeSingle();
  return !!appt;
}

export async function techWorkedCustomer(
  empId: string | null | undefined,
  hcpCustomerId: string,
): Promise<boolean> {
  if (!empId || !hcpCustomerId) return false;
  const supa = db();
  const { data: jobs } = await supa
    .from("jobs_master")
    .select("assigned_employees")
    .eq("hcp_customer_id", hcpCustomerId)
    .limit(500);
  if ((jobs ?? []).some((j) => assignedHasEmployee(j.assigned_employees as string | null, empId))) return true;
  const { data: appt } = await supa
    .from("appointments_master")
    .select("id")
    .eq("hcp_customer_id", hcpCustomerId)
    .contains("tech_all_ids", [empId])
    .limit(1)
    .maybeSingle();
  return !!appt;
}
