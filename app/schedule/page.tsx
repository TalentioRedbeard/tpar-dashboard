// Schedule v1.5 — visual schedule with day/week/month views, filters, color modes.
//
// URL params drive everything (server-side rendering, no client JS for nav):
//   ?date=YYYY-MM-DD            center date (default: today)
//   ?view=day|week|month        layout granularity (default: week)
//   ?color=status|tech|plaid    cell coloring (default: plaid = status fill + tech border)
//   ?status=csv                 status whitelist (default: all)
//   ?tech=name                  single-tech filter (default: all)
//   ?customer=text              substring match on customer_name (default: none)
//   ?revenue=1                  only appts with total_amount > 0
//   ?action=1                   only appts that "require action" (see needsAction below)
//
// Gate: admin + manager only (techs use /me for their own day).
// Read-only v1.5; drag-to-reassign is v2.

import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { fmtMoney } from "../../components/Table";
import { getCurrentTech } from "../../lib/current-tech";
import { TechAvatar } from "../../components/TechAvatar";
import { CellAddMenu } from "../../components/CellAddMenu";
import { RescheduleButton } from "../../components/RescheduleButton";
import { PendingChangesBar } from "../../components/PendingChangesBar";
import { listPendingChanges, type PendingChange } from "../../lib/schedule-changes";
import { getTechOrder } from "../../lib/schedule-order";
import { TechOrderControl } from "../../components/TechOrderControl";
import { resolveTechColor } from "../../lib/tech-colors";
import { DraggableAppt } from "../../components/DraggableAppt";
import { DropCell } from "../../components/DropCell";

export const metadata = { title: "Schedule · TPAR-DB" };
export const dynamic = "force-dynamic";

const CHI = "America/Chicago";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

type CrewMember = { full: string; short: string; avatarUrl: string | null; colorHex: string | null };

type Appt = {
  appointment_id: string | null;
  hcp_job_id: string | null;
  hcp_customer_id: string | null;
  scheduled_start: string;
  scheduled_end: string | null;
  status: string | null;
  appointment_type: string | null;
  tech_primary_name: string | null;
  tech_all_names: string[] | null;
  customer_name: string | null;
  street: string | null;
  city: string | null;
  total_amount: number | null;
  flags: string[] | null;
  // Attached server-side: the crew with photos + assigned colors (lead first),
  // and the lead's color for the card's left border.
  crew?: CrewMember[];
  leadColorHex?: string | null;
};

type Tech = {
  tech_short_name: string;
  hcp_full_name: string;
  is_lead: boolean | null;
  avatar_url: string | null;
  color_hex: string | null;
};

type ViewMode = "day" | "week" | "month";
type ColorMode = "status" | "tech" | "plaid";

type Filters = {
  status: string[] | null;   // null = all
  tech: string | null;
  customer: string | null;
  revenueOnly: boolean;
  actionOnly: boolean;
};

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const TEST_CUSTOMER_SQL = '("cus_9cf8cc5b02e1430a85288b034763cc19","cus_386a644b8054483788825c86c1b13b9c")';
const INTERNAL_CUSTOMER_IDS = new Set(["cus_051289f5b070471bbbe475ddc9e60a18"]);

// Status whitelist for the dropdown — these are the values that actually
// appear in appointments_master (confirmed via query 2026-05-27).
const STATUS_OPTIONS = [
  { value: "scheduled",                 label: "Scheduled" },
  { value: "in progress",               label: "In progress" },
  { value: "complete unrated",          label: "Complete (unrated)" },
  { value: "complete rated",            label: "Complete (rated)" },
  { value: "created job from estimate", label: "From estimate" },
  { value: "pro canceled",              label: "Pro canceled" },
  { value: "user canceled",             label: "User canceled" },
] as const;

// Tailwind needs literal class strings. This palette is hand-mapped so that
// the JIT picks up all the variants at build time. 8 distinct hues; techs are
// hashed into the palette deterministically by name.
const TECH_PALETTE: Array<{ border: string; chip: string; dot: string; fillTint: string }> = [
  { border: "border-l-rose-500",    chip: "bg-rose-100 text-rose-900",       dot: "bg-rose-500",    fillTint: "bg-rose-50" },
  { border: "border-l-orange-500",  chip: "bg-orange-100 text-orange-900",   dot: "bg-orange-500",  fillTint: "bg-orange-50" },
  { border: "border-l-amber-500",   chip: "bg-amber-100 text-amber-900",     dot: "bg-amber-500",   fillTint: "bg-amber-50" },
  { border: "border-l-emerald-500", chip: "bg-emerald-100 text-emerald-900", dot: "bg-emerald-500", fillTint: "bg-emerald-50" },
  { border: "border-l-teal-500",    chip: "bg-teal-100 text-teal-900",       dot: "bg-teal-500",    fillTint: "bg-teal-50" },
  { border: "border-l-sky-500",     chip: "bg-sky-100 text-sky-900",         dot: "bg-sky-500",     fillTint: "bg-sky-50" },
  { border: "border-l-violet-500",  chip: "bg-violet-100 text-violet-900",   dot: "bg-violet-500",  fillTint: "bg-violet-50" },
  { border: "border-l-fuchsia-500", chip: "bg-fuchsia-100 text-fuchsia-900", dot: "bg-fuchsia-500", fillTint: "bg-fuchsia-50" },
];

const UNASSIGNED_COLOR = { border: "border-l-neutral-400", chip: "bg-neutral-100 text-neutral-700", dot: "bg-neutral-400", fillTint: "bg-neutral-50" };

// ──────────────────────────────────────────────────────────────────────────────
// Date helpers (Chicago-local)
// ──────────────────────────────────────────────────────────────────────────────

function chicagoTodayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: CHI });
}

function keyToDate(key: string): Date {
  return new Date(`${key}T12:00:00-05:00`);
}

function shiftKey(key: string, days: number): string {
  const d = keyToDate(key);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toLocaleDateString("en-CA", { timeZone: CHI });
}

function chicagoDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: CHI });
}

function chicagoTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: CHI,
    hour: "numeric",
    minute: "2-digit",
  });
}

// 'HH:MM' → '2:00pm' (for proposed reschedule times)
function hm12(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
}

function dayHeader(key: string): { weekday: string; mmdd: string } {
  const d = keyToDate(key);
  return {
    weekday: d.toLocaleDateString("en-US", { timeZone: CHI, weekday: "short" }),
    mmdd: d.toLocaleDateString("en-US", { timeZone: CHI, month: "numeric", day: "numeric" }),
  };
}

function dayOfMonth(key: string): number {
  return Number(key.split("-")[2]);
}

function monthOfKey(key: string): number {
  return Number(key.split("-")[1]);
}

function monthYearLabel(key: string): string {
  const d = keyToDate(key);
  return d.toLocaleDateString("en-US", { timeZone: CHI, month: "long", year: "numeric" });
}

// First Sunday on/before key
function sundayOnOrBefore(key: string): string {
  const d = keyToDate(key);
  // getUTCDay returns the weekday for the UTC moment, which at noon -05:00
  // == ~5pm UTC = same calendar day → safe to use.
  const dow = d.getUTCDay();
  return shiftKey(key, -dow);
}

// ──────────────────────────────────────────────────────────────────────────────
// Color helpers
// ──────────────────────────────────────────────────────────────────────────────

function statusTone(status: string | null): { fill: string; border: string; text: string } {
  switch ((status ?? "").toLowerCase()) {
    case "complete":
    case "complete rated":
    case "complete unrated":
      return { fill: "bg-emerald-100", border: "border-emerald-300", text: "text-emerald-900" };
    case "in progress":
    case "en route":
      return { fill: "bg-blue-100", border: "border-blue-300", text: "text-blue-900" };
    case "scheduled":
      return { fill: "bg-neutral-100", border: "border-neutral-300", text: "text-neutral-800" };
    case "canceled":
    case "cancelled":
    case "pro canceled":
    case "user canceled":
      return { fill: "bg-red-50", border: "border-red-200", text: "text-red-800 line-through opacity-60" };
    case "needs scheduling":
      return { fill: "bg-amber-100", border: "border-amber-300", text: "text-amber-900" };
    case "created job from estimate":
      return { fill: "bg-indigo-100", border: "border-indigo-300", text: "text-indigo-900" };
    default:
      return { fill: "bg-neutral-100", border: "border-neutral-300", text: "text-neutral-700" };
  }
}

function techColor(name: string | null) {
  if (!name || name === "Unassigned") return UNASSIGNED_COLOR;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TECH_PALETTE[h % TECH_PALETTE.length];
}

function isInternalAppt(id?: string | null): boolean {
  return !!id && INTERNAL_CUSTOMER_IDS.has(id);
}

// ──────────────────────────────────────────────────────────────────────────────
// Filter logic
// ──────────────────────────────────────────────────────────────────────────────

function parseFilters(searchParams: Record<string, string | undefined>): Filters {
  const status = searchParams.status
    ? searchParams.status.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  const tech = searchParams.tech?.trim() || null;
  const customer = searchParams.customer?.trim().toLowerCase() || null;
  const revenueOnly = searchParams.revenue === "1";
  const actionOnly = searchParams.action === "1";
  return { status, tech, customer, revenueOnly, actionOnly };
}

function needsAction(a: Appt, nowIso: string): boolean {
  if (!a.tech_primary_name) return true;
  if (a.flags && a.flags.length > 0) return true;
  const start = a.scheduled_start;
  const end = a.scheduled_end ?? start;
  const status = (a.status ?? "").toLowerCase();
  if (start < nowIso && (status === "scheduled" || status === "created job from estimate")) return true;
  if (end < nowIso && status === "in progress") return true;
  return false;
}

function applyFilters(appts: Appt[], filters: Filters, nowIso: string): Appt[] {
  return appts.filter((a) => {
    if (filters.status && filters.status.length > 0) {
      if (!filters.status.includes((a.status ?? "").toLowerCase())) return false;
    }
    if (filters.tech && filters.tech !== (a.tech_primary_name ?? "")) return false;
    if (filters.customer && !(a.customer_name ?? "").toLowerCase().includes(filters.customer)) return false;
    if (filters.revenueOnly && (Number(a.total_amount) || 0) <= 0) return false;
    if (filters.actionOnly && !needsAction(a, nowIso)) return false;
    return true;
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// URL builders — keep all state in URL so nav doesn't lose filters
// ──────────────────────────────────────────────────────────────────────────────

function buildUrl(
  base: Record<string, string | undefined>,
  overrides: Record<string, string | null>,
): string {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v) merged[k] = v;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null || v === "") delete merged[k];
    else merged[k] = v;
  }
  const qs = new URLSearchParams(merged).toString();
  return qs ? `/schedule?${qs}` : "/schedule";
}

// ──────────────────────────────────────────────────────────────────────────────
// Cell rendering (shared across views)
// ──────────────────────────────────────────────────────────────────────────────

type CellOpts = {
  color: ColorMode;
  compact?: boolean;   // for month view: render as 1-line pill
};

function CrewAvatars({ crew, size }: { crew: CrewMember[]; size: number }) {
  if (crew.length === 0) return null;
  return (
    <span className="flex items-center gap-0.5">
      {crew.slice(0, 4).map((m) => (
        <TechAvatar key={m.full} shortName={m.short} avatarUrl={m.avatarUrl} colorHex={m.colorHex} size={size} />
      ))}
      {crew.length > 4 ? <span className="text-[9px] opacity-70">+{crew.length - 4}</span> : null}
    </span>
  );
}

function ApptBlock({ a, opts }: { a: Appt; opts: CellOpts }) {
  const stTone = statusTone(a.status);
  const tcol = techColor(a.tech_primary_name);
  const internal = isInternalAppt(a.hcp_customer_id);
  const crew = a.crew ?? [];
  const dollars = (Number(a.total_amount) || 0) / 100;

  // Color composition:
  //   "status" mode  → fill = status; left border = neutral
  //   "tech" mode    → fill = tech tint; left border = LEAD's assigned color
  //   "plaid" mode   → fill = status; left border = LEAD's assigned color (the "plaid")
  const fillClass = opts.color === "tech" ? tcol.fillTint : stTone.fill;
  const textClass = opts.color === "tech" ? "text-neutral-900" : stTone.text;
  const leadBorder = opts.color === "status" ? null : (a.leadColorHex ?? null);
  const borderLeftClass = (opts.color === "status" || !leadBorder) ? "border-l-neutral-300" : "";
  const borderStyle = leadBorder ? { borderLeftColor: leadBorder } : undefined;

  const containerClass = `relative rounded-md border ${stTone.border} border-l-4 ${borderLeftClass} ${fillClass} ${textClass} hover:brightness-95`;

  if (opts.compact) {
    return (
      <div className={`${containerClass} px-1.5 py-0.5 text-[10px] leading-tight`} style={borderStyle}>
        <div className="flex items-baseline gap-1">
          <span className="font-mono font-semibold">{chicagoTime(a.scheduled_start)}</span>
          <span className="truncate font-medium">{a.customer_name ?? "—"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${containerClass} px-1.5 py-1 text-[11px] leading-tight`} style={borderStyle}>
      <div className="flex items-baseline justify-between gap-1">
        <span className="font-mono text-[10px] font-semibold">{chicagoTime(a.scheduled_start)}</span>
        {dollars > 0 && <span className="text-[10px] font-medium">{fmtMoney(dollars)}</span>}
      </div>
      <div className="mt-0.5 truncate font-medium">{a.customer_name ?? "—"}</div>
      {internal && (
        <span className="mt-0.5 inline-block rounded-sm bg-violet-200/70 px-1 text-[9px] font-semibold uppercase tracking-wide text-violet-900">
          internal
        </span>
      )}
      {crew.length > 0 && <div className="mt-0.5"><CrewAvatars crew={crew} size={16} /></div>}
    </div>
  );
}

function ApptDetail({ a, opts }: { a: Appt; opts: CellOpts }) {
  // Used in day view — wider cells, more detail.
  const stTone = statusTone(a.status);
  const tcol = techColor(a.tech_primary_name);
  const internal = isInternalAppt(a.hcp_customer_id);
  const crew = a.crew ?? [];
  const dollars = (Number(a.total_amount) || 0) / 100;
  const fillClass = opts.color === "tech" ? tcol.fillTint : stTone.fill;
  const textClass = opts.color === "tech" ? "text-neutral-900" : stTone.text;
  const leadBorder = opts.color === "status" ? null : (a.leadColorHex ?? null);
  const borderLeftClass = (opts.color === "status" || !leadBorder) ? "border-l-neutral-300" : "";
  const borderStyle = leadBorder ? { borderLeftColor: leadBorder } : undefined;

  return (
    <div className={`rounded-md border ${stTone.border} border-l-4 ${borderLeftClass} ${fillClass} ${textClass} px-2 py-1.5 text-xs hover:brightness-95`} style={borderStyle}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-semibold">{chicagoTime(a.scheduled_start)}</span>
        <CrewAvatars crew={crew} size={18} />
      </div>
      <div className="mt-0.5 font-semibold">{a.customer_name ?? "—"}</div>
      {a.street && (
        <div className="text-[11px] opacity-80">
          {a.street}{a.city ? `, ${a.city}` : ""}
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-baseline gap-1.5">
        <span className="rounded-sm border px-1 py-0.5 text-[9px] font-medium opacity-80">
          {a.status ?? "—"}
        </span>
        {internal && (
          <span className="rounded-sm bg-violet-200/70 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-900">
            internal
          </span>
        )}
        {(a.flags ?? []).length > 0 && (
          <span className="rounded-sm bg-amber-200/70 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-900">
            flag
          </span>
        )}
        {dollars > 0 && <span className="ml-auto text-[11px] font-semibold">{fmtMoney(dollars)}</span>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────────

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/schedule");
  if (!me.isAdmin && !me.isManager) redirect("/me");
  const canApply = me.isAdmin || me.isManager; // MGMT can apply (page is already MGMT-gated); each apply is logged to dispatch_audit

  const params = await searchParams;
  const todayKey = chicagoTodayKey();

  // Parse URL state
  const centerKey = (() => {
    const d = params.date;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return todayKey;
    const dd = keyToDate(d);
    if (Number.isNaN(dd.getTime())) return todayKey;
    return d;
  })();
  const view: ViewMode = (params.view === "day" || params.view === "month" ? params.view : "week");
  const color: ColorMode = (params.color === "status" || params.color === "tech" ? params.color : "plaid");
  const filters = parseFilters(params);
  // Test-customer jobs (Danny-as-customer artifacts) are hidden from the lanes by
  // default; ?include_test=1 reveals them so create/edit flows can be validated.
  const includeTest = params.include_test === "1";

  // Compute window keys per view
  let windowKeys: string[];
  let monthGridKeys: string[] = []; // 5-6 week grid for month view
  let activeMonthMonth = 0;          // 1-12 for the centered month
  if (view === "day") {
    windowKeys = [centerKey];
  } else if (view === "week") {
    windowKeys = [];
    for (let i = -3; i <= 3; i++) windowKeys.push(shiftKey(centerKey, i));
  } else {
    // month — anchor on the 1st of the centered month's calendar grid
    activeMonthMonth = monthOfKey(centerKey);
    const monthFirst = `${centerKey.slice(0, 7)}-01`;
    const gridStart = sundayOnOrBefore(monthFirst);
    // 6 weeks max (some months span 6 calendar weeks); trim to 5 if last row is all next-month
    monthGridKeys = [];
    for (let i = 0; i < 42; i++) monthGridKeys.push(shiftKey(gridStart, i));
    // Trim trailing row if no day in it belongs to the active month
    const lastRow = monthGridKeys.slice(35, 42);
    if (lastRow.every((k) => monthOfKey(k) !== activeMonthMonth)) monthGridKeys = monthGridKeys.slice(0, 35);
    windowKeys = monthGridKeys;
  }

  // Query window: pad to cover the visible date range
  const windowStartKey = windowKeys[0];
  const windowEndKey = shiftKey(windowKeys[windowKeys.length - 1], 1);
  const windowStartUtc = new Date(`${windowStartKey}T00:00:00-05:00`).toISOString();
  const windowEndUtc = new Date(`${windowEndKey}T00:00:00-05:00`).toISOString();

  const supa = db();
  const nowIso = new Date().toISOString();

  let apptQuery = supa
    .from("appointments_master")
    .select(
      "appointment_id, hcp_job_id, hcp_customer_id, scheduled_start, scheduled_end, status, appointment_type, tech_primary_name, tech_all_names, customer_name, street, city, total_amount, flags",
    )
    .is("deleted_at", null)
    .gte("scheduled_start", windowStartUtc)
    .lt("scheduled_start", windowEndUtc);
  if (!includeTest) apptQuery = apptQuery.not("hcp_customer_id", "in", TEST_CUSTOMER_SQL);

  const [apptRes, techRes] = await Promise.all([
    apptQuery.order("scheduled_start", { ascending: true }),
    supa
      .from("tech_directory")
      .select("tech_short_name, hcp_full_name, dashboard_role, is_lead, is_active, avatar_url, color_hex")
      .eq("is_active", true)
      .neq("is_test", true)
      .in("dashboard_role", ["tech", "admin"])
      .order("is_lead", { ascending: false })
      .order("tech_short_name"),
  ]);

  const rawAppts = (apptRes.data ?? []) as Appt[];
  const techs = (techRes.data ?? []) as Tech[];

  // Apply filters
  const appts = applyFilters(rawAppts, filters, nowIso);

  // Bucket by (tech, day)
  const cellKey = (tech: string, dayKey: string) => `${tech}|${dayKey}`;
  const cells = new Map<string, Appt[]>();
  const cellByDay = new Map<string, Appt[]>();
  for (const a of appts) {
    const dayKey = chicagoDateKey(a.scheduled_start);
    const tech = a.tech_primary_name ?? "Unassigned";
    const k = cellKey(tech, dayKey);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k)!.push(a);
    if (!cellByDay.has(dayKey)) cellByDay.set(dayKey, []);
    cellByDay.get(dayKey)!.push(a);
  }

  // Row order: the dispatcher's saved order first (#21), else leads-first default;
  // then any extra primary names, then Unassigned.
  const savedTechOrder = await getTechOrder();
  const techFulls = techs.map((t) => t.hcp_full_name).filter(Boolean) as string[];
  const orderedTechFulls = [...techFulls].sort((a, b) => {
    const ia = savedTechOrder.indexOf(a), ib = savedTechOrder.indexOf(b);
    if (ia === -1 && ib === -1) return techFulls.indexOf(a) - techFulls.indexOf(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  const rowOrder: string[] = [...orderedTechFulls];
  for (const a of appts) {
    const tech = a.tech_primary_name;
    if (tech && !rowOrder.includes(tech) && tech !== "Unassigned") rowOrder.push(tech);
  }
  if (appts.some((a) => !a.tech_primary_name)) rowOrder.push("Unassigned");

  const shortByFull = new Map<string, string>();
  for (const t of techs) if (t.hcp_full_name) shortByFull.set(t.hcp_full_name, t.tech_short_name);
  const orderedTechsForControl = orderedTechFulls.map((full) => ({ full, short: shortByFull.get(full) ?? full.split(" ")[0] }));

  const apptCountByTech = new Map<string, number>();
  const dollarsByTech = new Map<string, number>();
  for (const a of appts) {
    const tech = a.tech_primary_name ?? "Unassigned";
    apptCountByTech.set(tech, (apptCountByTech.get(tech) ?? 0) + 1);
    dollarsByTech.set(tech, (dollarsByTech.get(tech) ?? 0) + (Number(a.total_amount) || 0));
  }

  // Photos by full name (for the row labels).
  const avatarByFull = new Map<string, string | null>();
  for (const t of techs) if (t.hcp_full_name) avatarByFull.set(t.hcp_full_name, t.avatar_url ?? null);

  // Assigned colors + lead set (Madisson #3). Attach to each appt: the crew with
  // photos + colors (lead first) and the lead's color for the card border.
  const colorByFull = new Map<string, string | null>();
  for (const t of techs) if (t.hcp_full_name) colorByFull.set(t.hcp_full_name, t.color_hex ?? null);
  const leadSet = new Set<string>();
  for (const t of techs) if (t.hcp_full_name && t.is_lead) leadSet.add(t.hcp_full_name);
  for (const a of appts) {
    const members = (a.tech_all_names && a.tech_all_names.length ? a.tech_all_names : (a.tech_primary_name ? [a.tech_primary_name] : []))
      .filter((n): n is string => !!n);
    // Lead = the is_lead crew member; prefer the primary if it's a lead, else the
    // first listed lead, else fall back to the primary (decided default).
    const primary = a.tech_primary_name ?? null;
    const leadFull = (primary && leadSet.has(primary)) ? primary
      : members.find((m) => leadSet.has(m)) ?? primary ?? members[0] ?? null;
    const ordered = [...new Set([leadFull, ...members].filter((n): n is string => !!n))];
    a.crew = ordered.map((full) => ({
      full,
      short: shortByFull.get(full) ?? full.split(" ")[0],
      avatarUrl: avatarByFull.get(full) ?? null,
      colorHex: colorByFull.get(full) ?? null,
    }));
    a.leadColorHex = leadFull ? resolveTechColor(leadFull, colorByFull) : null;
  }

  // Assist counts: appts where a tech rides along (on tech_all_names) but isn't the
  // primary. This is why helpers like Anthony/Chris look empty — they assist, not
  // lead. We surface "assisting N" on their row so each row reads accurately.
  const assistCountByTech = new Map<string, number>();
  for (const a of appts) {
    for (const n of a.tech_all_names ?? []) {
      if (n && n !== a.tech_primary_name) assistCountByTech.set(n, (assistCountByTech.get(n) ?? 0) + 1);
    }
  }

  // Pending reschedule proposals (#21), keyed by appointment.
  const pendingChanges = await listPendingChanges();
  const pendingByAppt = new Map<string, PendingChange>(pendingChanges.filter((c) => c.appointment_id).map((c) => [c.appointment_id as string, c]));
  const apptCountByDay = new Map<string, number>();
  const dollarsByDay = new Map<string, number>();
  for (const a of appts) {
    const k = chicagoDateKey(a.scheduled_start);
    apptCountByDay.set(k, (apptCountByDay.get(k) ?? 0) + 1);
    dollarsByDay.set(k, (dollarsByDay.get(k) ?? 0) + (Number(a.total_amount) || 0));
  }

  const linkFor = (overrides: Record<string, string | null>): string => buildUrl(params, overrides);

  const centerLabel = (() => {
    if (view === "month") return monthYearLabel(centerKey);
    const d = keyToDate(centerKey);
    const isToday = centerKey === todayKey;
    const long = d.toLocaleDateString("en-US", { timeZone: CHI, weekday: "long", month: "long", day: "numeric", year: "numeric" });
    return isToday ? `Today · ${long}` : long;
  })();

  const filterCount = [
    filters.status?.length,
    filters.tech ? 1 : 0,
    filters.customer ? 1 : 0,
    filters.revenueOnly ? 1 : 0,
    filters.actionOnly ? 1 : 0,
  ].reduce<number>((s, n) => s + (n ?? 0), 0);

  // ────────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <PageShell
      title="🗓️ Schedule"
      description={`${appts.length}${rawAppts.length !== appts.length ? `/${rawAppts.length}` : ""} appointment${appts.length === 1 ? "" : "s"} · ${view} view${filterCount > 0 ? ` · ${filterCount} filter${filterCount === 1 ? "" : "s"} active` : ""}`}
      help={{
        intent: "Visual schedule. Day = one tall column. Week = 7-col tech-row Gantt. Month = calendar grid. Click any block to open the job.",
        actions: [
          "View: Day / Week / Month — Day shows rich detail; Month shows volume + tech mix.",
          "Color: Status fills cells, Tech tints them, Plaid combines both (left-border = tech, fill = status).",
          "Filters: status / tech / customer-search / only-with-$ / requires-action. They stick across navigation.",
          "Arrows still stride by ±1d / ±7d / ±30d regardless of view.",
        ],
        stuck: <>Empty everywhere? HCP sync may be paused — check <Link href="/admin/system" className="underline">/admin/system</Link>.</>,
      }}
    >
      {/* DATE NAV — sticky */}
      <div className="sticky top-0 z-30 -mx-4 mb-3 flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Link href={linkFor({ date: shiftKey(centerKey, -30) })} className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50" title="Back one month">« Month</Link>
        <Link href={linkFor({ date: shiftKey(centerKey, -7) })} className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50" title="Back one week">‹ Week</Link>
        <Link href={linkFor({ date: shiftKey(centerKey, -1) })} className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50" title="Back one day">‹ Day</Link>

        <div className="mx-3 flex-1 text-center">
          <div className="text-sm font-semibold text-neutral-900">{centerLabel}</div>
          {view !== "month" && (
            <div className="text-[11px] text-neutral-500">
              {windowKeys[0]}{windowKeys.length > 1 ? ` → ${windowKeys[windowKeys.length - 1]}` : ""}
            </div>
          )}
        </div>

        <Link href={linkFor({ date: shiftKey(centerKey, 1) })} className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50" title="Forward one day">Day ›</Link>
        <Link href={linkFor({ date: shiftKey(centerKey, 7) })} className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50" title="Forward one week">Week ›</Link>
        <Link href={linkFor({ date: shiftKey(centerKey, 30) })} className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50" title="Forward one month">Month »</Link>

        {centerKey !== todayKey && (
          <Link href={linkFor({ date: null })} className="ml-2 rounded-md border border-brand-300 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100">Today</Link>
        )}
      </div>

      {/* CONTROLS: VIEW + COLOR (button groups) */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-md border border-neutral-200 bg-white p-0.5">
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">View</span>
          {(["day", "week", "month"] as ViewMode[]).map((v) => (
            <Link
              key={v}
              href={linkFor({ view: v === "week" ? null : v })}
              className={`rounded px-2.5 py-1 text-xs font-medium capitalize ${view === v ? "bg-brand-100 text-brand-900" : "text-neutral-700 hover:bg-neutral-100"}`}
            >
              {v}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-md border border-neutral-200 bg-white p-0.5">
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Color</span>
          {(["status", "tech", "plaid"] as ColorMode[]).map((c) => (
            <Link
              key={c}
              href={linkFor({ color: c === "plaid" ? null : c })}
              className={`rounded px-2.5 py-1 text-xs font-medium capitalize ${color === c ? "bg-brand-100 text-brand-900" : "text-neutral-700 hover:bg-neutral-100"}`}
            >
              {c}
            </Link>
          ))}
        </div>
      </div>

      {view !== "month" ? <div className="mb-3"><TechOrderControl techs={orderedTechsForControl} /></div> : null}

      <PendingChangesBar changes={pendingChanges} canApply={canApply} />

      <div className="mb-3 text-[11px]">
        {includeTest ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
            Showing test-customer jobs · <Link href="/schedule" className="underline">hide</Link>
          </span>
        ) : (
          <Link href="/schedule?include_test=1" className="text-neutral-400 hover:text-neutral-600 hover:underline">show test-customer jobs</Link>
        )}
      </div>

      {/* LEGEND — what the colors mean (the "plaid" key) */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-600">
        <span className="font-semibold uppercase tracking-wide text-neutral-500">Legend</span>
        <span className="font-medium text-neutral-700">Tier:</span>
        <span className="rounded-sm bg-emerald-100 px-1 text-[9px] font-semibold uppercase text-emerald-800">lead</span>
        <span className="rounded-sm bg-sky-100 px-1 text-[9px] font-semibold uppercase text-sky-800">apprentice</span>
        <span className="text-neutral-300">|</span>
        <span className="font-medium text-neutral-700">Status:</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-neutral-200" /> scheduled</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-blue-200" /> in progress</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-200" /> complete</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-200" /> needs sched</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-indigo-200" /> from estimate</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-100" /> canceled</span>
        <span className="text-neutral-300">|</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-1 rounded-sm bg-rose-500" /> left-edge = tech color (plaid)</span>
        <span className="inline-flex items-center gap-1 text-neutral-500">+N assist = rides along on N jobs</span>
        <span className="text-neutral-300">|</span>
        <span className="inline-flex items-center gap-1 text-neutral-500"><span className="cursor-grab">✋</span> drag a job to another tech/day to propose a move</span>
      </div>

      {/* FILTER BAR — GET form preserves date/view/color via hidden inputs */}
      <form action="/schedule" method="get" className="mb-4 rounded-2xl border border-neutral-200 bg-white p-3">
        {/* preserve non-filter URL state */}
        {params.date && <input type="hidden" name="date" value={params.date} />}
        {view !== "week" && <input type="hidden" name="view" value={view} />}
        {color !== "plaid" && <input type="hidden" name="color" value={color} />}

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Status</span>
            <select
              name="status"
              defaultValue={filters.status?.[0] ?? ""}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
            >
              <option value="">All</option>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Tech</span>
            <select
              name="tech"
              defaultValue={filters.tech ?? ""}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
            >
              <option value="">All</option>
              {techs.filter((t) => t.hcp_full_name).map((t) => (
                <option key={t.hcp_full_name} value={t.hcp_full_name}>{t.tech_short_name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Customer search</span>
            <input
              type="text"
              name="customer"
              defaultValue={filters.customer ?? ""}
              placeholder="Last name, company…"
              className="w-48 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
            />
          </label>

          <label className="flex items-center gap-1.5 text-xs text-neutral-700">
            <input type="checkbox" name="revenue" value="1" defaultChecked={filters.revenueOnly} className="h-3.5 w-3.5" />
            Only with $
          </label>

          <label className="flex items-center gap-1.5 text-xs text-neutral-700" title="Unassigned, flagged, past+still-scheduled, or in-progress past end-time">
            <input type="checkbox" name="action" value="1" defaultChecked={filters.actionOnly} className="h-3.5 w-3.5" />
            Requires action
          </label>

          <div className="ml-auto flex items-center gap-2">
            <button type="submit" className="rounded-md border border-brand-300 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100">
              Apply
            </button>
            {filterCount > 0 && (
              <Link href={buildUrl(params, { status: null, tech: null, customer: null, revenue: null, action: null })} className="text-xs text-neutral-500 underline hover:text-neutral-800">
                Clear filters
              </Link>
            )}
          </div>
        </div>
      </form>

      {/* VIEW DISPATCH */}
      {view === "day" && (
        <DayView
          dayKey={centerKey}
          rowOrder={rowOrder}
          cells={cells}
          techs={techs}
          shortByFull={shortByFull}
          avatarByFull={avatarByFull}
          apptCountByTech={apptCountByTech}
          dollarsByTech={dollarsByTech}
          assistCountByTech={assistCountByTech}
          pendingByAppt={pendingByAppt}
          color={color}
          todayKey={todayKey}
        />
      )}

      {view === "week" && (
        <WeekView
          windowKeys={windowKeys}
          rowOrder={rowOrder}
          cells={cells}
          techs={techs}
          shortByFull={shortByFull}
          avatarByFull={avatarByFull}
          apptCountByTech={apptCountByTech}
          dollarsByTech={dollarsByTech}
          assistCountByTech={assistCountByTech}
          apptCountByDay={apptCountByDay}
          dollarsByDay={dollarsByDay}
          color={color}
          todayKey={todayKey}
        />
      )}

      {view === "month" && (
        <MonthView
          gridKeys={monthGridKeys}
          centerKey={centerKey}
          activeMonth={activeMonthMonth}
          cellByDay={cellByDay}
          color={color}
          todayKey={todayKey}
          linkFor={linkFor}
        />
      )}

      <p className="mt-4 text-xs text-neutral-500">
        v1.5 · read-only · drag-to-reassign coming later. For today's intake/AR/map, use{" "}
        <Link href="/dispatch" className="underline">/dispatch</Link>.
      </p>
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Day view — 1 day, tech rows, rich cells
// ──────────────────────────────────────────────────────────────────────────────

function DayView({
  dayKey, rowOrder, cells, techs, shortByFull, avatarByFull, apptCountByTech, dollarsByTech, assistCountByTech, pendingByAppt, color, todayKey,
}: {
  dayKey: string;
  rowOrder: string[];
  cells: Map<string, Appt[]>;
  techs: Tech[];
  shortByFull: Map<string, string>;
  avatarByFull: Map<string, string | null>;
  apptCountByTech: Map<string, number>;
  dollarsByTech: Map<string, number>;
  assistCountByTech: Map<string, number>;
  pendingByAppt: Map<string, PendingChange>;
  color: ColorMode;
  todayKey: string;
}) {
  const isToday = dayKey === todayKey;
  const isPast = dayKey < todayKey;
  return (
    <div className={`overflow-hidden rounded-2xl border ${isToday ? "border-amber-300" : "border-neutral-200"} bg-white`}>
      <div className={`border-b ${isToday ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-neutral-50"} px-4 py-2 text-sm font-semibold ${isToday ? "text-amber-900" : "text-neutral-800"}`}>
        {dayHeader(dayKey).weekday} · {dayHeader(dayKey).mmdd}
        {isToday && <span className="ml-2 text-xs font-normal text-amber-700">(today)</span>}
      </div>
      <div className="divide-y divide-neutral-100">
        {rowOrder.length === 0 ? (
          <div className="p-6 text-center text-sm text-neutral-500">No active techs.</div>
        ) : rowOrder.map((techFullName) => {
          const short = shortByFull.get(techFullName) ?? techFullName.split(" ")[0];
          const isLead = techs.find((t) => t.hcp_full_name === techFullName)?.is_lead === true;
          const cell = cells.get(`${techFullName}|${dayKey}`) ?? [];
          const dollars = (dollarsByTech.get(techFullName) ?? 0) / 100;
          const count = apptCountByTech.get(techFullName) ?? 0;
          const assist = assistCountByTech.get(techFullName) ?? 0;
          const tcol = techColor(techFullName);
          return (
            <div key={techFullName} className="flex gap-3 px-3 py-2">
              <div className={`flex w-44 shrink-0 items-center gap-2 border-l-4 ${tcol.border} pl-2`}>
                {techFullName !== "Unassigned" ? <TechAvatar shortName={short} avatarUrl={avatarByFull.get(techFullName) ?? null} /> : null}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-neutral-900">{short}</span>
                    {isLead ? <span className="rounded-sm bg-emerald-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-800">lead</span>
                      : techFullName !== "Unassigned" ? <span className="rounded-sm bg-sky-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-800">apprentice</span> : null}
                    {techFullName === "Unassigned" && <span className="rounded-sm bg-red-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-800">unassigned</span>}
                  </div>
                  <div className="text-[11px] text-neutral-500">{count}{dollars > 0 ? ` · ${fmtMoney(dollars)}` : ""}{assist > 0 ? ` · +${assist} assist` : ""}</div>
                </div>
              </div>
              <DropCell techFull={techFullName} dateKey={dayKey} disabled={isPast || !techs.some((t) => t.hcp_full_name === techFullName)} className="grid flex-1 grid-cols-1 gap-1.5 rounded-md sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {cell.length === 0 ? (
                  <div className="col-span-full flex items-center gap-2 text-[11px] text-neutral-400">
                    {isPast ? <span className="text-neutral-300">— Open day</span> : <><span>Open day</span><CellAddMenu techFull={techFullName} dateKey={dayKey} compact /></>}
                  </div>
                ) : cell.map((a) => {
                  const chg = a.appointment_id ? pendingByAppt.get(a.appointment_id) : undefined;
                  return (
                    <DraggableAppt
                      key={a.appointment_id ?? a.hcp_job_id ?? Math.random()}
                      payload={{ apptId: a.appointment_id, hcpJobId: a.hcp_job_id, customerName: a.customer_name, currentStart: a.scheduled_start, currentTech: techFullName, currentDate: dayKey }}
                    >
                      <div className="space-y-0.5">
                        {a.hcp_job_id ? (
                          <Link href={`/job/${a.hcp_job_id}`} className="block"><ApptDetail a={a} opts={{ color }} /></Link>
                        ) : (
                          <ApptDetail a={a} opts={{ color }} />
                        )}
                        {(a.appointment_id && !isPast) || chg ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {a.appointment_id && !isPast ? <RescheduleButton appointmentId={a.appointment_id} hcpJobId={a.hcp_job_id} customerName={a.customer_name} currentStart={a.scheduled_start} dateKey={dayKey} /> : null}
                            {chg ? <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-800">→ proposed {hm12(chg.proposed_start_time)}</span> : null}
                          </div>
                        ) : null}
                      </div>
                    </DraggableAppt>
                  );
                })}
                {cell.length > 0 && !isPast ? <div className="flex items-center"><CellAddMenu techFull={techFullName} dateKey={dayKey} compact /></div> : null}
              </DropCell>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Week view — 7 days × tech rows
// ──────────────────────────────────────────────────────────────────────────────

function WeekView({
  windowKeys, rowOrder, cells, techs, shortByFull, avatarByFull, apptCountByTech, dollarsByTech, assistCountByTech, apptCountByDay, dollarsByDay, color, todayKey,
}: {
  windowKeys: string[];
  rowOrder: string[];
  cells: Map<string, Appt[]>;
  techs: Tech[];
  shortByFull: Map<string, string>;
  avatarByFull: Map<string, string | null>;
  apptCountByTech: Map<string, number>;
  dollarsByTech: Map<string, number>;
  assistCountByTech: Map<string, number>;
  apptCountByDay: Map<string, number>;
  dollarsByDay: Map<string, number>;
  color: ColorMode;
  todayKey: string;
}) {
  if (rowOrder.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
        No appointments in this window with current filters.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
      <table className="w-full min-w-[1100px] border-collapse">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50">
            <th className="sticky left-0 z-10 w-44 border-r border-neutral-200 bg-neutral-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600">
              Tech
            </th>
            {windowKeys.map((k) => {
              const isToday = k === todayKey;
              const isPast = k < todayKey;
              const { weekday, mmdd } = dayHeader(k);
              return (
                <th key={k} className={`w-[14%] border-r border-neutral-200 px-2 py-2 text-center align-top ${isToday ? "bg-amber-100" : isPast ? "bg-neutral-100/60" : "bg-neutral-50"}`}>
                  <div className={`text-[11px] font-semibold uppercase tracking-wide ${isToday ? "text-amber-900" : isPast ? "text-neutral-500" : "text-neutral-700"}`}>{weekday}</div>
                  <div className={`text-sm font-semibold tabular-nums ${isToday ? "text-amber-900" : isPast ? "text-neutral-500" : "text-neutral-900"}`}>{mmdd}</div>
                  {isToday && <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700">Today</div>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rowOrder.map((techFullName, rowIdx) => {
            const short = shortByFull.get(techFullName) ?? techFullName.split(" ")[0];
            const isLead = techs.find((t) => t.hcp_full_name === techFullName)?.is_lead === true;
            const count = apptCountByTech.get(techFullName) ?? 0;
            const assist = assistCountByTech.get(techFullName) ?? 0;
            const dollars = (dollarsByTech.get(techFullName) ?? 0) / 100;
            const tcol = techColor(techFullName);
            return (
              <tr key={techFullName} className={rowIdx % 2 === 0 ? "bg-white" : "bg-neutral-50/40"}>
                <td className="sticky left-0 z-10 w-48 border-r border-b border-neutral-200 bg-inherit px-3 py-2 align-top">
                  <div className={`flex items-center gap-2 border-l-4 ${tcol.border} pl-2`}>
                    {techFullName !== "Unassigned" ? <TechAvatar shortName={short} avatarUrl={avatarByFull.get(techFullName) ?? null} /> : null}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-neutral-900">{short}</span>
                        {isLead ? <span className="rounded-sm bg-emerald-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-800">lead</span>
                          : techFullName !== "Unassigned" ? <span className="rounded-sm bg-sky-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-800">apprentice</span> : null}
                        {techFullName === "Unassigned" && <span className="rounded-sm bg-red-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-800">unassigned</span>}
                      </div>
                      <div className="text-[11px] text-neutral-500">{count} appt{count === 1 ? "" : "s"}{dollars > 0 ? ` · ${fmtMoney(dollars)}` : ""}{assist > 0 ? ` · +${assist} assist` : ""}</div>
                    </div>
                  </div>
                </td>
                {windowKeys.map((dayKey) => {
                  const cell = cells.get(`${techFullName}|${dayKey}`) ?? [];
                  const isToday = dayKey === todayKey;
                  const isPast = dayKey < todayKey;
                  return (
                    <td key={dayKey} className={`min-h-24 border-r border-b border-neutral-200 align-top ${isToday ? "bg-amber-50/60" : isPast ? "bg-neutral-50/40" : "bg-white"}`}>
                      <DropCell techFull={techFullName} dateKey={dayKey} disabled={isPast || !techs.some((t) => t.hcp_full_name === techFullName)} className="h-full min-h-16 rounded-md p-1">
                        {cell.length === 0 ? (
                          <div className="flex h-full min-h-16 items-center justify-center">
                            {isPast ? <span className="text-[10px] text-neutral-300">—</span> : <CellAddMenu techFull={techFullName} dateKey={dayKey} compact />}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {cell.map((a) => (
                              <DraggableAppt
                                key={a.appointment_id ?? a.hcp_job_id ?? Math.random()}
                                payload={{ apptId: a.appointment_id, hcpJobId: a.hcp_job_id, customerName: a.customer_name, currentStart: a.scheduled_start, currentTech: techFullName, currentDate: dayKey }}
                              >
                                {a.hcp_job_id ? (
                                  <Link href={`/job/${a.hcp_job_id}`} title={`${a.customer_name ?? "—"} · ${a.street ?? ""}${a.city ? ", " + a.city : ""} · ${a.status ?? ""}`} className="block">
                                    <ApptBlock a={a} opts={{ color }} />
                                  </Link>
                                ) : (
                                  <div title={`${a.customer_name ?? "—"} · ${a.status ?? ""}`}>
                                    <ApptBlock a={a} opts={{ color }} />
                                  </div>
                                )}
                              </DraggableAppt>
                            ))}
                            {!isPast ? <div className="pt-0.5"><CellAddMenu techFull={techFullName} dateKey={dayKey} compact /></div> : null}
                          </div>
                        )}
                      </DropCell>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-neutral-300 bg-neutral-50 text-xs">
            <td className="sticky left-0 z-10 border-r border-neutral-200 bg-neutral-50 px-3 py-2 text-right font-semibold text-neutral-600">
              Day totals
            </td>
            {windowKeys.map((k) => {
              const isToday = k === todayKey;
              const c = apptCountByDay.get(k) ?? 0;
              const d = (dollarsByDay.get(k) ?? 0) / 100;
              return (
                <td key={k} className={`border-r border-neutral-200 px-2 py-2 text-center tabular-nums ${isToday ? "bg-amber-100 font-semibold text-amber-900" : "text-neutral-700"}`}>
                  {c > 0 ? (<><div>{c} appt{c === 1 ? "" : "s"}</div>{d > 0 && <div className="text-[10px] opacity-70">{fmtMoney(d)}</div>}</>) : <span className="text-neutral-300">—</span>}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Month view — 5-6 week calendar grid
// ──────────────────────────────────────────────────────────────────────────────

function MonthView({
  gridKeys, centerKey, activeMonth, cellByDay, color, todayKey, linkFor,
}: {
  gridKeys: string[];
  centerKey: string;
  activeMonth: number;
  cellByDay: Map<string, Appt[]>;
  color: ColorMode;
  todayKey: string;
  linkFor: (overrides: Record<string, string | null>) => string;
}) {
  void centerKey; // kept for future "highlight selected day" feature
  const weekRows: string[][] = [];
  for (let i = 0; i < gridKeys.length; i += 7) weekRows.push(gridKeys.slice(i, i + 7));
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50">
            {weekdayNames.map((w) => (
              <th key={w} className="border-r border-neutral-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weekRows.map((row, ri) => (
            <tr key={ri} className="border-b border-neutral-200">
              {row.map((k) => {
                const dayAppts = cellByDay.get(k) ?? [];
                const isToday = k === todayKey;
                const inActiveMonth = monthOfKey(k) === activeMonth;
                const dollars = dayAppts.reduce((s, a) => s + (Number(a.total_amount) || 0), 0) / 100;
                const techsInDay = new Set(dayAppts.map((a) => a.tech_primary_name ?? "Unassigned"));
                const VISIBLE = 4;
                const visible = dayAppts.slice(0, VISIBLE);
                const overflow = dayAppts.length - visible.length;
                return (
                  <td
                    key={k}
                    className={`h-32 border-r border-neutral-200 align-top p-1.5 ${
                      isToday ? "bg-amber-50" : inActiveMonth ? "bg-white" : "bg-neutral-50/60"
                    }`}
                  >
                    <div className="mb-1 flex items-baseline justify-between gap-1">
                      <Link
                        href={linkFor({ view: "day", date: k })}
                        className={`text-xs font-semibold tabular-nums hover:underline ${isToday ? "text-amber-900" : inActiveMonth ? "text-neutral-900" : "text-neutral-400"}`}
                        title="Open day view for this date"
                      >
                        {dayOfMonth(k)}
                      </Link>
                      {dayAppts.length > 0 && (
                        <div className="flex items-baseline gap-1">
                          {/* tech-dot strip: one dot per distinct tech in the day */}
                          <div className="flex -space-x-0.5">
                            {Array.from(techsInDay).slice(0, 5).map((t) => {
                              const tc = techColor(t);
                              return <span key={t} title={t} className={`inline-block h-1.5 w-1.5 rounded-full ${tc.dot}`} />;
                            })}
                          </div>
                          <span className="text-[10px] font-medium text-neutral-500">{dayAppts.length}</span>
                        </div>
                      )}
                    </div>
                    {dayAppts.length > 0 && (
                      <div className="space-y-0.5">
                        {visible.map((a) => (
                          a.hcp_job_id ? (
                            <Link key={a.appointment_id ?? a.hcp_job_id} href={`/job/${a.hcp_job_id}`} className="block">
                              <ApptBlock a={a} opts={{ color, compact: true }} />
                            </Link>
                          ) : (
                            <div key={a.appointment_id ?? Math.random()}>
                              <ApptBlock a={a} opts={{ color, compact: true }} />
                            </div>
                          )
                        ))}
                        {overflow > 0 && (
                          <Link href={linkFor({ view: "day", date: k })} className="block px-1.5 py-0.5 text-[10px] font-medium text-brand-700 hover:underline">
                            + {overflow} more →
                          </Link>
                        )}
                        {dollars > 0 && (
                          <div className="px-1.5 pt-0.5 text-right text-[9px] font-medium text-neutral-500">
                            {fmtMoney(dollars)}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
