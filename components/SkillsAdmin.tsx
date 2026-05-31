"use client";

// Owner/admin authoring for the skillset layer (#9). Three sections: the skill
// catalog, per-tech grants, and per-work-type required skills. Mirrors the
// /admin/techs editable pattern (useTransition + server actions + inline errors).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createSkill, setSkillActive, grantTechSkill, revokeTechSkill, setWorkTypeRequirement,
  type Skill, type TechSkill, type WorkTypeReq,
} from "../lib/skills";

type Tech = { tech_id: string; tech_short_name: string; hcp_full_name: string | null };
type Res = { ok: boolean; error?: string };

const WORK_TYPE_SUGGESTIONS = ["Tankless install", "Tank water heater", "Sewer repair", "Trenchless sewer", "Drain cleaning", "Camera inspection", "Gas line", "Slab leak", "Repipe", "Excavation", "Backflow / PRV", "Toilet", "Fixtures", "Sump pump", "Remodel / rough-in", "Water treatment", "Commercial"];

export function SkillsAdmin({ skills, techs, techSkills, workReqs }: { skills: Skill[]; techs: Tech[]; techSkills: TechSkill[]; workReqs: WorkTypeReq[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  function run(fn: () => Promise<Res>) { setErr(null); start(async () => { const r = await fn(); if (!r.ok) setErr(r.error ?? "failed"); else router.refresh(); }); }

  const skillById = new Map(skills.map((s) => [s.id, s]));
  const activeSkills = skills.filter((s) => s.is_active);
  const grantsByTech = new Map<string, TechSkill[]>();
  for (const ts of techSkills) { const a = grantsByTech.get(ts.tech_id) ?? []; a.push(ts); grantsByTech.set(ts.tech_id, a); }
  const reqsByType = new Map<string, WorkTypeReq[]>();
  for (const r of workReqs) { const a = reqsByType.get(r.work_type) ?? []; a.push(r); reqsByType.set(r.work_type, a); }

  // catalog add form
  const [nSlug, setNSlug] = useState(""); const [nLabel, setNLabel] = useState(""); const [nCat, setNCat] = useState("");
  // work-type add form
  const [wt, setWt] = useState(""); const [wtSkill, setWtSkill] = useState(""); const [wtReq, setWtReq] = useState(true);

  return (
    <div className="space-y-8">
      {err ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div> : null}

      {/* 1 — CATALOG */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-800">Skill catalog · {activeSkills.length} active</h2>
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          <input value={nLabel} onChange={(e) => setNLabel(e.target.value)} placeholder="Skill label (e.g. Hydro-jetting)" className="min-w-[180px] flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
          <input value={nSlug} onChange={(e) => setNSlug(e.target.value)} placeholder="slug (auto if blank)" className="w-36 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
          <input value={nCat} onChange={(e) => setNCat(e.target.value)} placeholder="category" className="w-36 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
          <button type="button" disabled={pending || !nLabel.trim()} onClick={() => run(async () => { const r = await createSkill({ slug: nSlug || nLabel, label: nLabel, category: nCat }); if (r.ok) { setNSlug(""); setNLabel(""); setNCat(""); } return r; })} className="rounded-md bg-brand-700 px-3 py-1 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">Add skill</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <button key={s.id} type="button" disabled={pending} onClick={() => run(() => setSkillActive(s.id, !s.is_active))} title={s.is_active ? "active — click to retire" : "retired — click to restore"}
              className={`rounded-full border px-2 py-0.5 text-xs ${s.is_active ? "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50" : "border-dashed border-neutral-300 bg-neutral-50 text-neutral-400 line-through"}`}>
              {s.label}{s.category ? <span className="ml-1 text-[10px] text-neutral-400">{s.category}</span> : null}
            </button>
          ))}
        </div>
      </section>

      {/* 2 — TECH GRANTS */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-800">Who can do what</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {techs.map((t) => {
            const grants = grantsByTech.get(t.tech_id) ?? [];
            const grantedIds = new Set(grants.map((g) => g.skill_id));
            return (
              <div key={t.tech_id} className="rounded-xl border border-neutral-200 bg-white p-3">
                <div className="mb-1.5 text-sm font-semibold text-neutral-900">{t.tech_short_name}</div>
                <div className="flex flex-wrap gap-1.5">
                  {grants.length === 0 ? <span className="text-xs text-neutral-400">no skills yet</span> : grants.map((g) => (
                    <span key={g.skill_id} className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                      🛠 {g.label}
                      <button type="button" disabled={pending} onClick={() => run(() => revokeTechSkill(t.tech_id, g.skill_id))} className="text-emerald-500 hover:text-red-600" title="Remove">✕</button>
                    </span>
                  ))}
                </div>
                <select value="" disabled={pending} onChange={(e) => { if (e.target.value) run(() => grantTechSkill(t.tech_id, e.target.value)); }} className="mt-2 w-full rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600">
                  <option value="">+ add a skill…</option>
                  {activeSkills.filter((s) => !grantedIds.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3 — WORK-TYPE REQUIREMENTS */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-800">What each work type requires</h2>
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          <input list="wt-suggestions" value={wt} onChange={(e) => setWt(e.target.value)} placeholder="Work type (e.g. Sewer repair)" className="min-w-[160px] flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
          <datalist id="wt-suggestions">{WORK_TYPE_SUGGESTIONS.map((w) => <option key={w} value={w} />)}</datalist>
          <select value={wtSkill} onChange={(e) => setWtSkill(e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1 text-sm">
            <option value="">requires skill…</option>
            {activeSkills.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-neutral-600"><input type="checkbox" checked={wtReq} onChange={(e) => setWtReq(e.target.checked)} /> hard requirement</label>
          <button type="button" disabled={pending || !wt.trim() || !wtSkill} onClick={() => run(async () => { const r = await setWorkTypeRequirement(wt, wtSkill, wtReq, true); if (r.ok) { setWtSkill(""); } return r; })} className="rounded-md bg-brand-700 px-3 py-1 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">Add</button>
        </div>
        {reqsByType.size === 0 ? <div className="text-sm text-neutral-400">No work-type requirements defined yet.</div> : (
          <div className="space-y-2">
            {[...reqsByType.entries()].map(([type, reqs]) => (
              <div key={type} className="rounded-xl border border-neutral-200 bg-white p-2.5">
                <span className="text-sm font-medium text-neutral-900">{type}</span>
                <span className="ml-2 inline-flex flex-wrap gap-1.5">
                  {reqs.map((r) => { const s = skillById.get(r.skill_id); return (
                    <span key={r.skill_id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${r.required ? "border-amber-200 bg-amber-50 text-amber-800" : "border-neutral-200 bg-neutral-50 text-neutral-600"}`}>
                      {r.required ? "★" : "○"} {s?.label ?? r.skill_id}
                      <button type="button" disabled={pending} onClick={() => run(() => setWorkTypeRequirement(type, r.skill_id, r.required, false))} className="text-amber-500 hover:text-red-600" title="Remove">✕</button>
                    </span>
                  ); })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
