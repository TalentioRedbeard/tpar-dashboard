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
// Gate: admin + manager get the full dispatch grid below; techs get a scoped
// "My schedule" agenda (their own appointments only) via TechScheduleView.
// Read-only v1.5; drag-to-reassign is v2.

import Link from "next/link";
import { db } from "../lib/supabase";
import { PageShell } from "./PageShell";
import { fmtMoney } from "./Table";
import { AutoRefresh } from "./AutoRefresh";
import { TechDayTimeline, type TLRow, type TLActivity, type TLJob, type TLLifeSeg } from "./TechDayTimeline";
import { TechAvatar } from "./TechAvatar";
import { CellAddMenu } from "./CellAddMenu";
import { EstimateBadge } from "./EstimateBadge";
import { getEstimatesForCards, estimatesForCard, type CardEstimate } from "../lib/estimates-for-cards";
import { RescheduleButton } from "./RescheduleButton";
import { PendingChangesBar } from "./PendingChangesBar";
import { listPendingChanges, type PendingChange } from "../lib/schedule-changes";
import { getTechOrder } from "../lib/schedule-order";
import { TechOrderControl } from "./TechOrderControl";
import { resolveTechColor } from "../lib/tech-colors";
import { DraggableAppt } from "./DraggableAppt";
import { DropCell } from "./DropCell";

// ScheduleBoard — the shared visual schedule grid (day/week/month) extracted from
// app/schedule/page.tsx (2026-07-17) so BOTH /schedule (chrome="full") and /dispatch
// (chrome="compact", behind the Board/Map toggle) render the same interactive,
// drag-writes-to-HCP grid. The page keeps auth + the tech-scoped fork; this owns the
// data shaping + render. buildUrl is basePath-parameterized so nav/filter links stay
// on the host route (in compact mode there are no such links).

const CHI = "America/Chicago";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

type CrewMember = { full: string; short: string; avatarUrl: string | null; colorHex: string | null };

type Appt = {
  appointment_id: string | null;
  hcp_job_id: string | null;
  hcp_customer_id: string | null;
  hcp_estimate_id: string | null;
  scheduled_start: string;
  scheduled_end: string | null;
  status: string | null;
  appointment_type: string | null;
  tech_primary_name: string | null;
  tech_all_names: string[] | null;
  tech_all_ids: string[] | null;   // hcp_employee_ids of the crew — collision-safe money gate
  customer_name: string | null;
  street: string | null;
  city: string | null;
  total_amount: number | null;
  flags: string[] | null;
  // Attached server-side: the crew with photos + assigned colors (lead first),
  // and the lead's color for the card's left border.
  crew?: CrewMember[];
  leadColorHex?: string | null;
  // Attached server-side: HCP estimates tied to this card (deduped, self-filtered).
  estimates?: CardEstimate[];
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

// Minute-of-day helpers for the Day-tab timeline (#24).
const TZ_CHI = "America/Chicago";
function chiMinOfDay(iso: string): number {
  const s = new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ_CHI, hour: "2-digit", minute: "2-digit", hour12: false });
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}
function chiClockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ_CHI, hour: "numeric", minute: "2-digit" });
}
// tech_day_segments_v start/end are Chicago wall-clock timestamps (no tz) — read H:M directly.
function wallMinOfDay(ts: string): number {
  const m = ts.match(/[ T](\d\d):(\d\d)/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

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
  basePath = "/schedule",
): string {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v) merged[k] = v;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null || v === "") delete merged[k];
    else merged[k] = v;
  }
  const qs = new URLSearchParams(merged).toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

// ──────────────────────────────────────────────────────────────────────────────
// Cell rendering (shared across views)
// ──────────────────────────────────────────────────────────────────────────────

type CellOpts = {
  color: ColorMode;
  compact?: boolean;   // for month view: render as 1-line pill
  // Money gate: office (canSeeAllMoney) sees every job's $; a tech sees $ only on
  // jobs whose crew (tech_all_ids) includes their viewerEmpId. Default = show.
  canSeeAllMoney?: boolean;
  viewerEmpId?: string | null;
};

// Whether to show revenue on a given appointment's card, per the money gate.
function showMoneyFor(a: Appt, opts: CellOpts): boolean {
  if (opts.canSeeAllMoney ?? true) return true;
  return !!opts.viewerEmpId && (a.tech_all_ids ?? []).includes(opts.viewerEmpId);
}

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
  const showMoney = showMoneyFor(a, opts);

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
          {(a.estimates?.length ?? 0) > 0 && <span className="ml-auto"><EstimateBadge estimates={a.estimates!} size="sm" /></span>}
        </div>
      </div>
    );
  }

  return (
    <div className={`${containerClass} px-1.5 py-1 text-[11px] leading-tight`} style={borderStyle}>
      <div className="flex items-baseline justify-between gap-1">
        <span className="font-mono text-[10px] font-semibold">{chicagoTime(a.scheduled_start)}</span>
        <span className="flex items-center gap-1">
          {showMoney && dollars > 0 && <span className="text-[10px] font-medium">{fmtMoney(dollars)}</span>}
          {(a.estimates?.length ?? 0) > 0 && <EstimateBadge estimates={a.estimates!} size="sm" />}
        </span>
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
  const showMoney = showMoneyFor(a, opts);
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
        {(a.estimates?.length ?? 0) > 0 && <EstimateBadge estimates={a.estimates!} size="md" />}
        {showMoney && dollars > 0 && <span className="ml-auto text-[11px] font-semibold">{fmtMoney(dollars)}</span>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────────

type ScheduleBoardProps = {
  // Raw URL search params (the board parses date/view/color/filters/include_test
  // itself). /dispatch passes {} for a plain current-week board.
  params?: Record<string, string | undefined>;
  // Host route for nav/filter links — "/schedule" (full) keeps links on-page.
  basePath?: string;
  // Owner-only widgets (zero-photo jobs) render only when true.
  isAdmin?: boolean;
  // Whether the dispatcher may Apply pending changes to HCP.
  canApply?: boolean;
  // "full" = the whole /schedule page chrome; "compact" = grid only (for /dispatch).
  chrome?: "full" | "compact";
  // "office" = full write affordances (drag writes to HCP, create job/event).
  // "tech" = read-only board: drag becomes an office-approval REQUEST, create is
  // estimate-only, no reorder, no Apply, and revenue is money-gated (Danny 7/17).
  mode?: "office" | "tech";
  // The viewing tech's hcp_employee_id — the collision-safe "is this job mine"
  // key for the money gate (never match on names — second-Chris landmine).
  viewerEmpId?: string | null;
  // Office (admin/manager) sees all revenue; a tech sees $ only on their own jobs.
  canSeeAllMoney?: boolean;
};

export async function ScheduleBoard({
  params = {},
  basePath = "/schedule",
  isAdmin = false,
  canApply = false,
  chrome = "full",
  mode = "office",
  viewerEmpId = null,
  canSeeAllMoney = true,
}: ScheduleBoardProps) {
  const isTech = mode === "tech";
  const dropMode: "apply" | "request" = isTech ? "request" : "apply";
  const todayKey = chicagoTodayKey();

  // Parse URL state
  const centerKey = (() => {
    const d = params.date;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return todayKey;
    const dd = keyToDate(d);
    if (Number.isNaN(dd.getTime())) return todayKey;
    return d;
  })();
  const rawView: ViewMode = (params.view === "day" || params.view === "month" ? params.view : "week");
  // Techs never get the day timeline (it exposes per-job labor cost / $); coerce to week.
  const view: ViewMode = isTech && rawView === "day" ? "week" : rawView;
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
      "appointment_id, hcp_job_id, hcp_customer_id, hcp_estimate_id, scheduled_start, scheduled_end, status, appointment_type, tech_primary_name, tech_all_names, tech_all_ids, customer_name, street, city, total_amount, flags",
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

  // Photo accountability (Phase 1b): owner-only list of recently-completed jobs
  // with ZERO photos on file (jobs_zero_photos_v applies the >24h harvest-lag
  // grace window). Compact header section, admin-gated.
  type ZeroPhotoJob = { hcp_job_id: string; customer_name: string | null; tech_primary_name: string | null; job_date: string | null };
  let zeroPhotoJobs: ZeroPhotoJob[] = [];
  if (isAdmin) {
    const { data: zpData } = await supa
      .from("jobs_zero_photos_v")
      .select("hcp_job_id, customer_name, tech_primary_name, job_date")
      .limit(50);
    zeroPhotoJobs = (zpData ?? []) as ZeroPhotoJob[];
  }

  // Apply filters
  const appts = applyFilters(rawAppts, filters, nowIso);

  // Multi-visit jobs (>1 appointment in the loaded window): their blocks don't
  // drag — update-hcp-job moves the whole JOB, so a per-visit drag would move
  // every visit (segment-1 guard; applyJobMove also refuses server-side).
  const jobApptCounts = new Map<string, number>();
  for (const a of rawAppts) {
    if (a.hcp_job_id) jobApptCounts.set(a.hcp_job_id, (jobApptCounts.get(a.hcp_job_id) ?? 0) + 1);
  }
  const multiVisitJobs = new Set([...jobApptCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id));

  // Estimate badges: ONE batched RPC for the whole window's distinct job +
  // customer ids, then attach per card (deduped + self-filtered). N+1 guard.
  const estMaps = await getEstimatesForCards(
    appts.map((a) => a.hcp_job_id),
    appts.map((a) => a.hcp_customer_id),
    6,
  );
  for (const a of appts) {
    // On an estimate-type card, suppress its OWN estimate (don't badge itself).
    const ownId = a.appointment_type === "estimate" ? a.hcp_estimate_id : null;
    a.estimates = estimatesForCard(estMaps, a.hcp_job_id, a.hcp_customer_id, ownId);
  }

  // Bucket by (tech, day)
  const cellKey = (tech: string, dayKey: string) => `${tech}|${dayKey}`;
  const cells = new Map<string, Appt[]>();
  const cellByDay = new Map<string, Appt[]>();
  for (const a of appts) {
    const dayKey = chicagoDateKey(a.scheduled_start);
    // Populate EVERY assigned crew member's row (lead + helpers), not just the
    // primary, so a helper sees the jobs they're crewed on in their own row —
    // not just a "+N assist" count. (Danny 2026-06-12)
    const crew = (a.tech_all_names && a.tech_all_names.length
      ? a.tech_all_names
      : (a.tech_primary_name ? [a.tech_primary_name] : ["Unassigned"]))
      .filter((n): n is string => !!n);
    const rows = crew.length ? crew : ["Unassigned"];
    const seen = new Set<string>();
    for (const tech of rows) {
      if (seen.has(tech)) continue; // de-dupe if a name appears twice on a job
      seen.add(tech);
      const k = cellKey(tech, dayKey);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k)!.push(a);
    }
    // Day totals count each appt ONCE, regardless of crew size.
    if (!cellByDay.has(dayKey)) cellByDay.set(dayKey, []);
    cellByDay.get(dayKey)!.push(a);
  }

  // Row order: the dispatcher's saved order wins (#21). With NO saved order, the
  // DAY view groups same-job crews adjacent (ported from /dispatch/today's crew-walk)
  // so a 2-tech job's lanes sit together — Danny 2026-06-17; week/month keep the
  // leads-first default. Idle techs (no job in the window) always keep their lane,
  // appended in the default order, so e.g. a 0-job lead still shows.
  const savedTechOrder = await getTechOrder();
  const techFulls = techs.map((t) => t.hcp_full_name).filter(Boolean) as string[];
  const defaultOrder = [...techFulls]; // tech_directory already sorts leads-first, then alpha
  let orderedTechFulls: string[];
  if (savedTechOrder.length) {
    // Manual dispatcher order wins, all views.
    orderedTechFulls = [...techFulls].sort((a, b) => {
      const ia = savedTechOrder.indexOf(a), ib = savedTechOrder.indexOf(b);
      if (ia === -1 && ib === -1) return defaultOrder.indexOf(a) - defaultOrder.indexOf(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  } else if (view === "day") {
    // Crew-walk: walk the day's appts in start order, append each appt's crew
    // (primary first) the first time we see them — same-job crews land adjacent.
    // Then any active techs with no job today, in the leads-first/alpha default,
    // so idle lanes (e.g. Danny, 0 jobs) remain visible.
    const known = new Set(techFulls);
    const placed = new Set<string>();
    const walk: string[] = [];
    const dayAppts = [...appts].sort(
      (a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime(),
    );
    for (const a of dayAppts) {
      const crew = [a.tech_primary_name, ...(a.tech_all_names ?? [])].filter((n): n is string => !!n);
      for (const f of crew) if (known.has(f) && !placed.has(f)) { placed.add(f); walk.push(f); }
    }
    for (const f of defaultOrder) if (!placed.has(f)) { placed.add(f); walk.push(f); }
    orderedTechFulls = walk;
  } else {
    orderedTechFulls = defaultOrder;
  }
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

  // ── Day-tab timeline (#24): paint the day in lanes — clock + lifecycle + GPS
  // movement + running cost / live clock. Day-view-ONLY fetches; Week/Month untouched.
  let timelineRows: TLRow[] = [];
  let dayNowMin: number | null = null;
  if (view === "day") {
    const isTodayDay = centerKey === todayKey;
    dayNowMin = isTodayDay ? chiMinOfDay(nowIso) : null;
    const dayJobIds = [...new Set(appts.map((a) => a.hcp_job_id).filter((x): x is string => !!x))];

    const [lifeRes, clockRes, segRes, costRes] = await Promise.all([
      supa.from("job_lifecycle_events").select("hcp_job_id, trigger_number, fired_at")
        .gte("fired_at", windowStartUtc).lt("fired_at", windowEndUtc),
      supa.from("tech_time_entries").select("tech_short_name, kind, ts")
        .is("voided_at", null).gte("ts", windowStartUtc).lt("ts", windowEndUtc).order("ts", { ascending: true }),
      supa.from("tech_day_segments_v").select("tech_name, start_time, end_time, kind, label")
        .eq("trip_date_chicago", centerKey),
      dayJobIds.length
        ? supa.from("job_cost_v2").select("hcp_job_id, receipts_cost").in("hcp_job_id", dayJobIds)
        : Promise.resolve({ data: [] as Array<{ hcp_job_id: string; receipts_cost: string | null }> }),
    ]);

    const lifeByJob = new Map<string, { trigger_number: number; fired_at: string }[]>();
    for (const e of (lifeRes.data ?? []) as Array<{ hcp_job_id: string | null; trigger_number: number; fired_at: string }>) {
      if (!e.hcp_job_id) continue;
      const arr = lifeByJob.get(e.hcp_job_id) ?? [];
      arr.push({ trigger_number: e.trigger_number, fired_at: e.fired_at });
      lifeByJob.set(e.hcp_job_id, arr);
    }

    const matByJob = new Map<string, number>();
    for (const r of (costRes.data ?? []) as Array<{ hcp_job_id: string; receipts_cost: string | null }>) {
      matByJob.set(r.hcp_job_id, Number(r.receipts_cost) || 0);
    }

    const clockByShort = new Map<string, { startMin: number; endMin: number; open: boolean }[]>();
    const byTech = new Map<string, { kind: string; ts: string }[]>();
    for (const c of (clockRes.data ?? []) as Array<{ tech_short_name: string | null; kind: string; ts: string }>) {
      if (!c.tech_short_name) continue;
      const arr = byTech.get(c.tech_short_name) ?? [];
      arr.push({ kind: c.kind, ts: c.ts });
      byTech.set(c.tech_short_name, arr);
    }
    byTech.forEach((evs, short) => {
      const spans: { startMin: number; endMin: number; open: boolean }[] = [];
      let openIn: number | null = null;
      for (const e of evs) {
        if (e.kind === "in") openIn = chiMinOfDay(e.ts);
        else if (e.kind === "out" && openIn != null) { spans.push({ startMin: openIn, endMin: chiMinOfDay(e.ts), open: false }); openIn = null; }
      }
      if (openIn != null) spans.push({ startMin: openIn, endMin: isTodayDay && dayNowMin != null ? dayNowMin : 20 * 60, open: true });
      clockByShort.set(short, spans);
    });

    const actByShort = new Map<string, TLActivity[]>();
    for (const s of (segRes.data ?? []) as Array<{ tech_name: string | null; start_time: string; end_time: string | null; kind: string; label: string }>) {
      if (!s.tech_name || !s.end_time) continue;
      const arr = actByShort.get(s.tech_name) ?? [];
      arr.push({ startMin: wallMinOfDay(s.start_time), endMin: wallMinOfDay(s.end_time), kind: s.kind, label: s.label });
      actByShort.set(s.tech_name, arr);
    }

    const BURDEN = 35; // $/hr fully-burdened labor cost (flat placeholder; tech_burden_rates)
    const STATE: Record<number, { label: string; color: string }> = {
      2: { label: "On my way", color: "#2563eb" }, 3: { label: "Started", color: "#f59e0b" },
      4: { label: "Estimating", color: "#8b5cf6" }, 5: { label: "Presenting", color: "#a855f7" },
      6: { label: "Finished", color: "#16a34a" }, 7: { label: "Collected", color: "#15803d" },
    };
    const PLANNED = "#cbd5e1";

    const buildJob = (a: Appt, leadColor: string): TLJob => {
      const schedStart = chiMinOfDay(a.scheduled_start);
      const schedEnd = a.scheduled_end ? chiMinOfDay(a.scheduled_end) : schedStart + 60;
      const evs = (lifeByJob.get(a.hcp_job_id ?? "") ?? [])
        .filter((e) => e.trigger_number >= 2 && e.trigger_number <= 7)
        .sort((x, y) => (x.fired_at < y.fired_at ? -1 : 1));
      const segs: TLLifeSeg[] = [];
      if (evs.length === 0) {
        segs.push({ startMin: schedStart, endMin: Math.max(schedEnd, schedStart + 10), color: PLANNED, label: "Scheduled", planned: true });
      } else {
        const firstMin = chiMinOfDay(evs[0].fired_at);
        if (schedStart < firstMin) segs.push({ startMin: schedStart, endMin: firstMin, color: PLANNED, label: "Scheduled", planned: true });
        for (let i = 0; i < evs.length; i++) {
          const t = evs[i].trigger_number; const st = STATE[t]; if (!st) continue;
          const s = chiMinOfDay(evs[i].fired_at); const terminal = t === 6 || t === 7;
          let e2 = i < evs.length - 1 ? chiMinOfDay(evs[i + 1].fired_at) : (terminal ? s + 8 : (isTodayDay && dayNowMin != null ? dayNowMin : Math.max(schedEnd, s + 20)));
          if (e2 < s) e2 = s + 8;
          segs.push({ startMin: s, endMin: e2, color: st.color, label: `${st.label} ${chiClockOf(evs[i].fired_at)}`, planned: false });
        }
      }
      const lastEv = evs[evs.length - 1];
      const startEv = evs.find((e) => e.trigger_number === 3);
      const finishEv = evs.find((e) => e.trigger_number === 6 || e.trigger_number === 7);
      const finished = !!finishEv;
      const startMinOf = startEv ? chiMinOfDay(startEv.fired_at) : null;
      // Job chip duration: final Start→Finish total once finished, else a live
      // Start→now ticker while in progress (Danny 2026-06-17 — a completed job
      // should show how long it actually took, not go blank).
      const liveMinutes =
        startMinOf == null
          ? null
          : finished
            ? Math.max(0, chiMinOfDay(finishEv!.fired_at) - startMinOf)
            : isTodayDay && dayNowMin != null
              ? Math.max(0, dayNowMin - startMinOf)
              : null;
      const durationDone = finished && liveMinutes != null;
      const crewSize = Math.max(1, a.tech_all_names?.length ?? 1);
      const materials = a.hcp_job_id ? matByJob.get(a.hcp_job_id) ?? 0 : 0;
      const laborEst = liveMinutes != null ? (liveMinutes / 60) * BURDEN * crewSize : null;
      return {
        key: a.appointment_id ?? a.hcp_job_id ?? `${a.scheduled_start}-${a.customer_name ?? ""}`,
        hcpJobId: a.hcp_job_id, customer: a.customer_name,
        startMin: segs[0].startMin, endMin: segs[segs.length - 1].endMin,
        segs,
        curColor: lastEv ? STATE[lastEv.trigger_number]?.color ?? PLANNED : PLANNED,
        curState: lastEv ? STATE[lastEv.trigger_number]?.label ?? "Scheduled" : "Scheduled",
        leadColor, liveMinutes, durationDone, materials, laborEst,
      };
    };

    timelineRows = rowOrder.map((full) => {
      const short = shortByFull.get(full) ?? full.split(" ")[0];
      const unassigned = full === "Unassigned";
      const rowAppts = appts.filter((a) => {
        if (unassigned) return !a.tech_primary_name;
        const crew = a.tech_all_names && a.tech_all_names.length ? a.tech_all_names : (a.tech_primary_name ? [a.tech_primary_name] : []);
        return a.tech_primary_name === full || crew.includes(full);
      });
      const jobs = rowAppts.map((a) => buildJob(a, a.leadColorHex ?? resolveTechColor(full, colorByFull)));
      return {
        full, short,
        avatarUrl: avatarByFull.get(full) ?? null,
        colorHex: colorByFull.get(full) ?? null,
        isLead: leadSet.has(full),
        unassigned,
        apptCount: jobs.length,
        dollars: (dollarsByTech.get(full) ?? 0) / 100,
        clockSpans: clockByShort.get(short) ?? [],
        activity: actByShort.get(short) ?? [],
        jobs,
      };
    });
  }

  const linkFor = (overrides: Record<string, string | null>): string => buildUrl(params, overrides, basePath);

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
  // The grid itself (day timeline / week Gantt / month calendar), shared by both
  // the full page chrome and the compact /dispatch board.
  const grid = (
    <>
      {view === "day" && (
        <div className="space-y-2">
          {centerKey === todayKey ? <AutoRefresh seconds={60} /> : null}
          <div className={`rounded-t-2xl border px-4 py-2 text-sm font-semibold ${centerKey === todayKey ? "border-amber-300 bg-amber-50 text-amber-900" : "border-neutral-200 bg-neutral-50 text-neutral-800"}`}>
            {centerLabel}
          </div>
          <TechDayTimeline rows={timelineRows} isToday={centerKey === todayKey} nowMin={dayNowMin} />
        </div>
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
          multiVisitJobs={multiVisitJobs}
          canSeeAllMoney={canSeeAllMoney}
          viewerEmpId={viewerEmpId}
          dropMode={dropMode}
          addMode={mode}
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
          canSeeAllMoney={canSeeAllMoney}
          viewerEmpId={viewerEmpId}
        />
      )}
    </>
  );

  // Compact board for /dispatch: just the grid (drag writes to HCP immediately) +
  // a link out to the full schedule. No date-nav/filter/legend chrome — those need
  // page navigation that would reset the client Board/Map toggle.
  if (chrome === "compact") {
    return (
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-neutral-800">🗓️ {centerLabel}</h2>
          <Link href="/schedule" className="text-xs font-medium text-brand-700 hover:underline">Open full schedule ↗</Link>
        </div>
        <PendingChangesBar changes={pendingChanges} canApply={canApply} />
        {grid}
        <p className="text-xs text-neutral-500">
          Drag a job to another tech/day — it moves in HCP immediately (Undo on the chip; customers are never auto-notified). Multi-visit jobs don&apos;t drag yet.
        </p>
      </section>
    );
  }

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

      {/* Photo accountability (Phase 1b) — owner-only. Recently-completed jobs
          with zero photos on file. Collapsed by default; expands to the list. */}
      {isAdmin && zeroPhotoJobs.length > 0 ? (
        <details className="mb-3 rounded-2xl border border-amber-200 bg-amber-50">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-medium text-amber-900 hover:bg-amber-100/60">
            <span aria-hidden>📸</span>
            <span><strong>{zeroPhotoJobs.length}</strong> recently-completed job{zeroPhotoJobs.length === 1 ? "" : "s"} with no photos</span>
            <span className="ml-auto text-xs font-normal text-amber-700">click to view</span>
          </summary>
          <ul className="divide-y divide-amber-100 border-t border-amber-200">
            {zeroPhotoJobs.map((z) => (
              <li key={z.hcp_job_id}>
                <Link href={`/job/${z.hcp_job_id}`} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm hover:bg-amber-100/50">
                  <span className="font-medium text-neutral-900">{z.customer_name ?? "—"}</span>
                  <span className="text-xs text-neutral-500">
                    {z.tech_primary_name ? `${z.tech_primary_name} · ` : ""}
                    {z.job_date ? new Date(z.job_date).toLocaleDateString("en-US", { timeZone: CHI, month: "short", day: "numeric" }) : ""}
                  </span>
                  <span className="ml-auto text-xs text-brand-700">open job →</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* CONTROLS: VIEW + COLOR (button groups) */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-md border border-neutral-200 bg-white p-0.5">
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">View</span>
          {((isTech ? ["week", "month"] : ["day", "week", "month"]) as ViewMode[]).map((v) => (
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

      {!isTech && view !== "month" ? <div className="mb-3"><TechOrderControl techs={orderedTechsForControl} /></div> : null}

      {!isTech && <PendingChangesBar changes={pendingChanges} canApply={canApply} />}

      <div className="mb-3 text-[11px]">
        {includeTest ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
            Showing test-customer jobs · <Link href={basePath} className="underline">hide</Link>
          </span>
        ) : (
          <Link href={`${basePath}?include_test=1`} className="text-neutral-400 hover:text-neutral-600 hover:underline">show test-customer jobs</Link>
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
      <form action={basePath} method="get" className="mb-4 rounded-2xl border border-neutral-200 bg-white p-3">
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
              <Link href={buildUrl(params, { status: null, tech: null, customer: null, revenue: null, action: null }, basePath)} className="text-xs text-neutral-500 underline hover:text-neutral-800">
                Clear filters
              </Link>
            )}
          </div>
        </div>
      </form>

      {grid}

      <p className="mt-4 text-xs text-neutral-500">
        Drag a job to another tech/day — it moves in HCP immediately (Undo on the chip; customers are never auto-notified).
        Multi-visit jobs don&apos;t drag yet. For today&apos;s intake/AR/map, use{" "}
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
                  // If this row's tech isn't the job's lead, mark it as an assist
                  // so a helper's populated row still reads "who's leading".
                  const assistingLead = a.tech_primary_name && a.tech_primary_name !== techFullName
                    ? (shortByFull.get(a.tech_primary_name) ?? a.tech_primary_name.split(" ")[0])
                    : null;
                  return (
                    <DraggableAppt
                      key={a.appointment_id ?? a.hcp_job_id ?? Math.random()}
                      payload={{ apptId: a.appointment_id, hcpJobId: a.hcp_job_id, customerName: a.customer_name, currentStart: a.scheduled_start, currentTech: techFullName, currentDate: dayKey }}
                    >
                      <div className="space-y-0.5">
                        {assistingLead ? (
                          <span className="inline-block rounded bg-sky-50 px-1 py-0.5 text-[9px] font-medium text-sky-700 ring-1 ring-inset ring-sky-200">assisting {assistingLead}</span>
                        ) : null}
                        {a.hcp_job_id ? (
                          <Link href={`/job/${a.hcp_job_id}`} className="block"><ApptDetail a={a} opts={{ color }} /></Link>
                        ) : a.appointment_type === "estimate" && a.appointment_id ? (
                          // Estimate appointment (no job yet) → draft a multi-option
                          // estimate from the visit notes instead of dead-ending.
                          <Link href={`/estimate/new?appointment=${a.appointment_id}`} className="block"><ApptDetail a={a} opts={{ color }} /></Link>
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
  windowKeys, rowOrder, cells, techs, shortByFull, avatarByFull, apptCountByTech, dollarsByTech, assistCountByTech, apptCountByDay, dollarsByDay, color, todayKey, multiVisitJobs, canSeeAllMoney, viewerEmpId, dropMode, addMode,
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
  multiVisitJobs: Set<string>;
  canSeeAllMoney: boolean;
  viewerEmpId: string | null;
  dropMode: "apply" | "request";
  addMode: "office" | "tech";
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
                      <div className="text-[11px] text-neutral-500">{count} appt{count === 1 ? "" : "s"}{canSeeAllMoney && dollars > 0 ? ` · ${fmtMoney(dollars)}` : ""}{assist > 0 ? ` · +${assist} assist` : ""}</div>
                    </div>
                  </div>
                </td>
                {windowKeys.map((dayKey) => {
                  const cell = cells.get(`${techFullName}|${dayKey}`) ?? [];
                  const isToday = dayKey === todayKey;
                  const isPast = dayKey < todayKey;
                  return (
                    <td key={dayKey} className={`min-h-24 border-r border-b border-neutral-200 align-top ${isToday ? "bg-amber-50/60" : isPast ? "bg-neutral-50/40" : "bg-white"}`}>
                      <DropCell techFull={techFullName} dateKey={dayKey} mode={dropMode} disabled={isPast || !techs.some((t) => t.hcp_full_name === techFullName)} className="h-full min-h-16 rounded-md p-1">
                        {cell.length === 0 ? (
                          <div className="flex h-full min-h-16 items-center justify-center">
                            {isPast ? <span className="text-[10px] text-neutral-300">—</span> : <CellAddMenu techFull={techFullName} dateKey={dayKey} mode={addMode} compact />}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {cell.map((a) => {
                              // Mark assist cards so a helper's populated week row shows who leads.
                              const assisting = !!a.tech_primary_name && a.tech_primary_name !== techFullName;
                              return (
                              <DraggableAppt
                                key={a.appointment_id ?? a.hcp_job_id ?? Math.random()}
                                payload={{ apptId: a.appointment_id, hcpJobId: a.hcp_job_id, customerName: a.customer_name, currentStart: a.scheduled_start, currentTech: techFullName, currentDate: dayKey }}
                                multiVisit={!!a.hcp_job_id && multiVisitJobs.has(a.hcp_job_id)}
                              >
                                <div className="space-y-0.5">
                                  {assisting ? <span className="block text-[8px] font-semibold uppercase tracking-wide text-sky-600">assisting</span> : null}
                                  {a.hcp_job_id ? (
                                    <Link href={`/job/${a.hcp_job_id}`} title={`${a.customer_name ?? "—"} · ${a.street ?? ""}${a.city ? ", " + a.city : ""} · ${a.status ?? ""}`} className="block">
                                      <ApptBlock a={a} opts={{ color, canSeeAllMoney, viewerEmpId }} />
                                    </Link>
                                  ) : a.appointment_type === "estimate" && a.appointment_id ? (
                                    <Link href={`/estimate/new?appointment=${a.appointment_id}`} title={`${a.customer_name ?? "—"} · draft estimate from visit`} className="block">
                                      <ApptBlock a={a} opts={{ color, canSeeAllMoney, viewerEmpId }} />
                                    </Link>
                                  ) : (
                                    <div title={`${a.customer_name ?? "—"} · ${a.status ?? ""}`}>
                                      <ApptBlock a={a} opts={{ color, canSeeAllMoney, viewerEmpId }} />
                                    </div>
                                  )}
                                </div>
                              </DraggableAppt>
                              );
                            })}
                            {!isPast ? <div className="pt-0.5"><CellAddMenu techFull={techFullName} dateKey={dayKey} mode={addMode} compact /></div> : null}
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
                  {c > 0 ? (<><div>{c} appt{c === 1 ? "" : "s"}</div>{canSeeAllMoney && d > 0 && <div className="text-[10px] opacity-70">{fmtMoney(d)}</div>}</>) : <span className="text-neutral-300">—</span>}
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
  gridKeys, centerKey, activeMonth, cellByDay, color, todayKey, linkFor, canSeeAllMoney, viewerEmpId,
}: {
  gridKeys: string[];
  centerKey: string;
  activeMonth: number;
  cellByDay: Map<string, Appt[]>;
  color: ColorMode;
  todayKey: string;
  linkFor: (overrides: Record<string, string | null>) => string;
  canSeeAllMoney: boolean;
  viewerEmpId: string | null;
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
                              <ApptBlock a={a} opts={{ color, compact: true, canSeeAllMoney, viewerEmpId }} />
                            </Link>
                          ) : a.appointment_type === "estimate" && a.appointment_id ? (
                            <Link key={a.appointment_id} href={`/estimate/new?appointment=${a.appointment_id}`} className="block">
                              <ApptBlock a={a} opts={{ color, compact: true, canSeeAllMoney, viewerEmpId }} />
                            </Link>
                          ) : (
                            <div key={a.appointment_id ?? Math.random()}>
                              <ApptBlock a={a} opts={{ color, compact: true, canSeeAllMoney, viewerEmpId }} />
                            </div>
                          )
                        ))}
                        {overflow > 0 && (
                          <Link href={linkFor({ view: "day", date: k })} className="block px-1.5 py-0.5 text-[10px] font-medium text-brand-700 hover:underline">
                            + {overflow} more →
                          </Link>
                        )}
                        {canSeeAllMoney && dollars > 0 && (
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
