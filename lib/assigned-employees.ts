// Parse jobs_master.assigned_employees (a JSON-array-as-text of HCP "pro" objects)
// and test whether a given HCP pro id (tech_directory.hcp_employee_id, e.g.
// "pro_1ffe3d7e…") is on that job's crew.
//
// Used for tech photo-scoping after the gallery moved off job_360 (which carried
// tech_primary_name/tech_all_names) onto jobs_master (which carries assigned_employees).
// Matching by the pro `id` is stable + collision-free (unlike names). Safe on
// null/garbage input — returns false, so a tech with no resolvable id or a job with
// no parseable crew is DENIED, never over-shared.
export function assignedHasEmployee(
  raw: string | null | undefined,
  empId: string | null | undefined,
): boolean {
  if (!raw || !empId) return false;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.some(
      (p) => p && typeof p === "object" && (p as { id?: string }).id === empId,
    );
  } catch {
    return false;
  }
}
