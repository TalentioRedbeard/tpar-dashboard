// /alarms — admin surface for the wake-up alarm system.
// Admin-only (managers + techs see "permission denied").
// Shows: upcoming + active alarms, with cancel; recent past alarms with their
// attempts. To schedule new alarms tonight: use SQL — INSERT INTO wake_up_alarms.

import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";
import { PageShell } from "@/components/PageShell";
import { Section } from "@/components/ui/Section";
import { Pill } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/EmptyState";
import { AlarmCancelButton } from "@/components/AlarmCancelButton";

export const dynamic = "force-dynamic";

type AlarmRow = {
  id: string;
  name: string;
  fire_at: string;
  status: string;
  requirement_level: string;
  concurrent_channels: string[] | null;
  escalation_channels: string[] | null;
  ring_interval_seconds: number | null;
  hard_cap_minutes: number | null;
  escalate_after_attempts: number | null;
  to_phone: string | null;
  source_program: string | null;
  source_function: string | null;
  succeeded_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  last_attempt_at: string | null;
  created_at: string;
  created_by: string | null;
};

type AttemptRow = {
  id: string;
  alarm_id: string;
  attempt_number: number;
  fired_at: string;
  required_sequence: string;
  received_sequence: string | null;
  succeeded: boolean;
  finished_at: string | null;
  failure_reason: string | null;
  twilio_call_status: string | null;
};

function fmtTimeC(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtRelative(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const sign = ms > 0 ? "in " : "";
  const past = ms < 0 ? " ago" : "";
  if (abs < 60_000) return `${sign}${Math.round(abs / 1000)}s${past}`;
  if (abs < 3_600_000) return `${sign}${Math.round(abs / 60_000)}m${past}`;
  if (abs < 86_400_000) return `${sign}${Math.round(abs / 3_600_000)}h${past}`;
  return `${sign}${Math.round(abs / 86_400_000)}d${past}`;
}

function statusTone(status: string): Parameters<typeof Pill>[0]["tone"] {
  switch (status) {
    case "pending":   return "neutral";
    case "firing":    return "amber";
    case "succeeded": return "green";
    case "failed":    return "red";
    case "cancelled": return "slate";
    default:          return "neutral";
  }
}

export default async function AlarmsPage() {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/alarms");
  if (!me.isAdmin && !me.isManager) {
    return (
      <PageShell title="Alarms">
        <EmptyState title="Admin only" description="The alarms surface is restricted to admins and managers." />
      </PageShell>
    );
  }

  const supabase = db();

  const [{ data: upcoming }, { data: recent }, { data: attempts }] = await Promise.all([
    supabase
      .from("wake_up_alarms")
      .select("*")
      .in("status", ["pending", "firing"])
      .eq("active", true)
      .order("fire_at", { ascending: true })
      .limit(50),
    supabase
      .from("wake_up_alarms")
      .select("*")
      .in("status", ["succeeded", "failed", "cancelled"])
      .order("fire_at", { ascending: false })
      .limit(20),
    supabase
      .from("wake_up_attempts")
      .select("*")
      .order("fired_at", { ascending: false })
      .limit(120),
  ]);

  const ups = (upcoming ?? []) as AlarmRow[];
  const past = (recent ?? []) as AlarmRow[];
  const att = (attempts ?? []) as AttemptRow[];

  const attemptsByAlarm = new Map<string, AttemptRow[]>();
  for (const a of att) {
    const arr = attemptsByAlarm.get(a.alarm_id) ?? [];
    arr.push(a);
    attemptsByAlarm.set(a.alarm_id, arr);
  }

  return (
    <PageShell
      kicker="Wake-up system"
      title="Alarms"
      description={`${ups.length} upcoming · ${past.length} recent`}
    >
      <Section title="Upcoming + active">
        {ups.length === 0 ? (
          <EmptyState
            title="No alarms scheduled"
            description="Schedule one via SQL: INSERT INTO public.wake_up_alarms (name, fire_at, requirement_level) VALUES (...)"
          />
        ) : (
          <div className="space-y-3">
            {ups.map((a) => {
              const alarmAttempts = attemptsByAlarm.get(a.id) ?? [];
              return (
                <div key={a.id} className="overflow-hidden rounded-2xl border border-brand-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-baseline gap-3 border-b border-brand-100 bg-brand-50/50 px-4 py-3">
                    <h3 className="text-base font-semibold text-neutral-900">{a.name}</h3>
                    <Pill tone={statusTone(a.status)}>{a.status}</Pill>
                    <Pill tone="brand">{a.requirement_level}</Pill>
                    <div className="ml-auto flex items-baseline gap-3 text-sm">
                      <span className="text-neutral-500">fires</span>
                      <span className="font-medium text-neutral-900">{fmtTimeC(a.fire_at)}</span>
                      <span className="text-xs text-neutral-500">({fmtRelative(a.fire_at)})</span>
                    </div>
                  </div>
                  <div className="space-y-2 px-4 py-3 text-sm">
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-600">
                      <span>concurrent: <code className="rounded bg-neutral-100 px-1">{(a.concurrent_channels ?? []).join(", ") || "(none)"}</code></span>
                      <span>escalation: <code className="rounded bg-neutral-100 px-1">{(a.escalation_channels ?? []).join(", ") || "(none)"}</code></span>
                      <span>ring interval: {a.ring_interval_seconds}s · hard cap: {a.hard_cap_minutes}m · escalate after: {a.escalate_after_attempts}</span>
                    </div>
                    <div className="text-xs text-neutral-500">
                      created by {a.created_by ?? "(unknown)"} {fmtRelative(a.created_at)}
                      {a.last_attempt_at && <> · last attempt {fmtRelative(a.last_attempt_at)}</>}
                      {alarmAttempts.length > 0 && <> · {alarmAttempts.length} attempt{alarmAttempts.length === 1 ? "" : "s"}</>}
                    </div>
                    {alarmAttempts.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-brand-700 hover:underline">
                          Show attempts ({alarmAttempts.length})
                        </summary>
                        <ul className="mt-2 space-y-1 text-xs text-neutral-700">
                          {alarmAttempts.map((p) => (
                            <li key={p.id} className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-neutral-500">#{p.attempt_number}</span>
                              <span>{fmtTimeC(p.fired_at)}</span>
                              <span className="font-mono">expected {p.required_sequence}</span>
                              {p.received_sequence && <span className="font-mono">got {p.received_sequence}</span>}
                              {p.succeeded ? (
                                <Pill tone="green">matched</Pill>
                              ) : p.failure_reason ? (
                                <Pill tone="red">{p.failure_reason}</Pill>
                              ) : (
                                <Pill tone="neutral">in flight</Pill>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {me.isAdmin && (
                      <div className="pt-2">
                        <AlarmCancelButton alarmId={a.id} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <div className="mt-10">
        <Section title="Recent (last 20)">
          {past.length === 0 ? (
            <EmptyState title="No past alarms" description="History will appear here as alarms succeed, fail, or are cancelled." />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-neutral-100 text-sm">
                <thead className="bg-neutral-50 text-xs text-neutral-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-left font-medium">Fire at</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-left font-medium">Tier</th>
                    <th className="px-3 py-2 text-right font-medium">Attempts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {past.map((a) => {
                    const ct = (attemptsByAlarm.get(a.id) ?? []).length;
                    return (
                      <tr key={a.id}>
                        <td className="px-3 py-2 font-medium text-neutral-900">{a.name}</td>
                        <td className="px-3 py-2 text-neutral-700">{fmtTimeC(a.fire_at)}</td>
                        <td className="px-3 py-2"><Pill tone={statusTone(a.status)}>{a.status}</Pill></td>
                        <td className="px-3 py-2 text-neutral-600">{a.requirement_level}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{ct}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <div className="mt-10 rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4 text-xs text-neutral-600">
        <div className="font-medium text-neutral-700">How to schedule a new alarm</div>
        <p className="mt-1">
          New-alarm UI is queued for a future polish pass. Until then, insert via SQL:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md bg-white px-3 py-2 text-[11px] text-neutral-800">
{`INSERT INTO public.wake_up_alarms
  (name, fire_at, requirement_level)
VALUES
  ('My alarm',
   '2026-05-03 12:00:00+00'::timestamptz,  -- 7:00 AM CDT
   'critical');`}
        </pre>
        <p className="mt-2">
          Defaults applied: <code>concurrent_channels={'{twilio-call,pushover-emergency}'}</code>{" "}
          <code>ring_interval_seconds=90</code> <code>hard_cap_minutes=30</code>{" "}
          <code>escalate_after_attempts=5</code>. Override any column inline.
        </p>
      </div>

      <div className="mt-6 text-xs text-neutral-500">
        <Link href="/admin" className="hover:underline">← Admin home</Link>
      </div>
    </PageShell>
  );
}
