"use client";

// #26 owner-only tech home entry. Saving geocodes server-side (set-tech-home).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTechHome, type TechHome } from "../lib/tech-home-actions";

export function TechHomeForm({ tech }: { tech: TechHome }) {
  const router = useRouter();
  const [addr, setAddr] = useState(tech.home_address ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = () =>
    start(async () => {
      setErr(null); setMsg(null);
      const r = await setTechHome(tech.tech_id, addr);
      if (!r.ok) { setErr(r.error ?? "failed"); return; }
      setMsg(addr.trim() ? `✓ ${r.formatted ?? "saved"}` : "✓ cleared");
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-24 shrink-0 text-sm font-medium text-neutral-800">{tech.tech_short_name}</span>
      <input
        value={addr}
        onChange={(e) => setAddr(e.target.value)}
        placeholder="home address (street, city, state)"
        disabled={pending}
        className="min-w-[260px] flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
      <button type="button" onClick={save} disabled={pending} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">
        {pending ? "…" : "Save"}
      </button>
      <span className="text-[11px] text-neutral-500">{tech.home_lat ? "📍 on file" : "—"}</span>
      {msg ? <span className="text-[11px] text-green-700">{msg}</span> : null}
      {err ? <span className="text-[11px] text-red-600">{err}</span> : null}
    </div>
  );
}
