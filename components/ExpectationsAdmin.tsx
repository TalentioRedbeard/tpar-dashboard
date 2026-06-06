"use client";

// ExpectationsAdmin — owner editor for daily expectations (/admin/expectations).
// Author short daily tasks/reminders; scope each global / by role / by person.
// They render on each employee's /me "My day" panel. Mutations are owner-gated
// server actions (lib/expectations-actions).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Expectation } from "../lib/expectations";
import { upsertExpectation, setExpectationActive, deleteExpectation, type ExpectationInput } from "../lib/expectations-actions";

const ROLES = ["tech", "manager", "production_manager", "admin"] as const;
const CATEGORIES = ["field_ops", "sales", "compliance", "comms", "safety", "other"];

const blank: ExpectationInput = {
  title: "", detail: "", icon: "", category: "", scope_type: "global",
  scope_roles: [], scope_person: "", link_href: "", link_label: "", sort_order: 100,
  effective_from: "", effective_through: "",
};

function toInput(e: Expectation): ExpectationInput {
  return {
    id: e.id, title: e.title, detail: e.detail ?? "", icon: e.icon ?? "", category: e.category ?? "",
    scope_type: e.scope_type, scope_roles: e.scope_roles ?? [], scope_person: e.scope_person ?? "",
    link_href: e.link_href ?? "", link_label: e.link_label ?? "", sort_order: e.sort_order,
    effective_from: e.effective_from ?? "", effective_through: e.effective_through ?? "",
  };
}

function scopeLabel(e: Expectation): string {
  if (e.scope_type === "global") return "Everyone";
  if (e.scope_type === "role") return `Role: ${(e.scope_roles ?? []).join(", ") || "—"}`;
  return `Person: ${e.scope_person ?? "—"}`;
}

export function ExpectationsAdmin({ items, techNames }: { items: Expectation[]; techNames: string[] }) {
  const router = useRouter();
  const [form, setForm] = useState<ExpectationInput | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = (patch: Partial<ExpectationInput>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const save = () => {
    if (!form) return;
    setErr(null);
    start(async () => {
      const res = await upsertExpectation(form);
      if (!res.ok) { setErr(res.error); return; }
      setForm(null);
      router.refresh();
    });
  };

  const toggle = (e: Expectation) => start(async () => { await setExpectationActive(e.id, !e.is_active); router.refresh(); });
  const remove = (e: Expectation) => {
    if (!confirm(`Delete "${e.title}"? This can't be undone.`)) return;
    start(async () => { await deleteExpectation(e.id); router.refresh(); });
  };

  const toggleRole = (r: string) => set({
    scope_roles: form?.scope_roles?.includes(r) ? form.scope_roles.filter((x) => x !== r) : [...(form?.scope_roles ?? []), r],
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-600">{items.length} expectation{items.length === 1 ? "" : "s"}. These show on each employee&rsquo;s &ldquo;My day&rdquo; page.</p>
        <button onClick={() => { setForm({ ...blank }); setErr(null); }} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">
          ➕ New expectation
        </button>
      </div>

      {form ? (
        <div className="rounded-2xl border border-brand-300 bg-brand-50/40 p-4">
          <h3 className="mb-3 text-sm font-semibold text-neutral-800">{form.id ? "Edit" : "New"} expectation</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-neutral-600 sm:col-span-2">
              Title
              <input value={form.title} onChange={(e) => set({ title: e.target.value })} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900" placeholder="Clock in when you start" />
            </label>
            <label className="text-xs font-medium text-neutral-600 sm:col-span-2">
              Detail
              <textarea value={form.detail ?? ""} onChange={(e) => set({ detail: e.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900" placeholder="A sentence of guidance." />
            </label>
            <label className="text-xs font-medium text-neutral-600">
              Icon (emoji)
              <input value={form.icon ?? ""} onChange={(e) => set({ icon: e.target.value })} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" placeholder="✅" />
            </label>
            <label className="text-xs font-medium text-neutral-600">
              Category
              <select value={form.category ?? ""} onChange={(e) => set({ category: e.target.value })} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm">
                <option value="">—</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>

            <label className="text-xs font-medium text-neutral-600">
              Shows for
              <select value={form.scope_type} onChange={(e) => set({ scope_type: e.target.value as ExpectationInput["scope_type"] })} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm">
                <option value="global">Everyone</option>
                <option value="role">A role</option>
                <option value="person">One person</option>
              </select>
            </label>
            <label className="text-xs font-medium text-neutral-600">
              Sort order
              <input type="number" value={form.sort_order ?? 100} onChange={(e) => set({ sort_order: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
            </label>

            {form.scope_type === "role" ? (
              <div className="text-xs font-medium text-neutral-600 sm:col-span-2">
                Roles
                <div className="mt-1 flex flex-wrap gap-2">
                  {ROLES.map((r) => (
                    <button key={r} type="button" onClick={() => toggleRole(r)} className={`rounded-full border px-3 py-1 text-xs ${form.scope_roles?.includes(r) ? "border-brand-500 bg-brand-100 text-brand-800" : "border-neutral-300 bg-white text-neutral-600"}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {form.scope_type === "person" ? (
              <label className="text-xs font-medium text-neutral-600 sm:col-span-2">
                Person (tech)
                <select value={form.scope_person ?? ""} onChange={(e) => set({ scope_person: e.target.value })} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm">
                  <option value="">— pick a tech —</option>
                  {techNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            ) : null}

            <label className="text-xs font-medium text-neutral-600">
              Link (optional)
              <input value={form.link_href ?? ""} onChange={(e) => set({ link_href: e.target.value })} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" placeholder="/whiteboard" />
            </label>
            <label className="text-xs font-medium text-neutral-600">
              Link label
              <input value={form.link_label ?? ""} onChange={(e) => set({ link_label: e.target.value })} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" placeholder="Open the board" />
            </label>

            <label className="text-xs font-medium text-neutral-600">
              Effective from (optional)
              <input type="date" value={form.effective_from ?? ""} onChange={(e) => set({ effective_from: e.target.value })} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium text-neutral-600">
              Effective through (optional)
              <input type="date" value={form.effective_through ?? ""} onChange={(e) => set({ effective_through: e.target.value })} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
            </label>
          </div>

          {err ? <p className="mt-3 text-sm text-red-600">{err}</p> : null}
          <div className="mt-4 flex gap-2">
            <button onClick={save} disabled={pending} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {pending ? "Saving…" : "Save"}
            </button>
            <button onClick={() => { setForm(null); setErr(null); }} className="rounded-lg border border-neutral-300 px-4 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <ul className="space-y-2">
        {items.map((e) => (
          <li key={e.id} className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${e.is_active ? "border-neutral-200 bg-white" : "border-neutral-200 bg-neutral-50 opacity-70"}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span aria-hidden>{e.icon ?? "•"}</span>
                <span className="text-sm font-semibold text-neutral-900">{e.title}</span>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">{scopeLabel(e)}</span>
                {e.category ? <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">{e.category}</span> : null}
                {!e.is_active ? <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-600">hidden</span> : null}
              </div>
              {e.detail ? <p className="mt-1 text-xs text-neutral-600">{e.detail}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs">
              <button onClick={() => { setForm(toInput(e)); setErr(null); }} className="rounded-md border border-neutral-300 px-2 py-1 text-neutral-700 hover:bg-neutral-50">Edit</button>
              <button onClick={() => toggle(e)} disabled={pending} className="rounded-md border border-neutral-300 px-2 py-1 text-neutral-700 hover:bg-neutral-50">{e.is_active ? "Hide" : "Show"}</button>
              <button onClick={() => remove(e)} disabled={pending} className="rounded-md border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50">Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
