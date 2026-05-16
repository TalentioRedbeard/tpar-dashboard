"use client";

// One row of the rates table. Toggles between read mode (value + scope
// notes inline) and edit mode (small form). Edit mode is admin-only;
// the parent page gates rendering.

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Pill, type Tone } from "../../../components/ui/Pill";
import { updateRate } from "./actions";

export type RateRow = {
  rate_key: string;
  category: string;
  display_name: string;
  unit: "flat" | "hour" | "percent" | "each";
  amount_cents: number;
  is_active: boolean;
  scope_notes: string | null;
  effective_since: string;
  updated_by: string | null;
  updated_at: string;
};

function fmtValue(unit: RateRow["unit"], cents: number): string {
  if (unit === "percent") return `${cents}%`;
  const dollars = cents / 100;
  if (unit === "flat") return `$${dollars.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  if (unit === "hour") return `$${dollars.toFixed(0)}/hr`;
  if (unit === "each") return `$${dollars.toFixed(2)} ea`;
  return `${cents}¢`;
}

function categoryTone(cat: string): Tone {
  switch (cat) {
    case "service":     return "brand";
    case "labor":       return "violet";
    case "travel":      return "slate";
    case "after_hours": return "amber";
    case "discount":    return "green";
    case "membership":  return "violet";
    default:            return "slate";
  }
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

export function RateEditRow({ r, canEdit }: { r: RateRow; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);

  // Read mode is the default and what non-admins see.
  if (!editing || !canEdit) {
    return (
      <tr className={r.is_active ? "hover:bg-neutral-50" : "bg-neutral-50/50 text-neutral-400"}>
        <td className="px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-neutral-900">{r.display_name}</span>
            <Pill tone={categoryTone(r.category)}>{r.category}</Pill>
            {!r.is_active ? <Pill tone="slate">inactive</Pill> : null}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-neutral-400">{r.rate_key}</div>
        </td>
        <td className="px-4 py-2 text-right font-mono tabular-nums text-base font-semibold text-neutral-900">
          {fmtValue(r.unit, r.amount_cents)}
        </td>
        <td className="px-4 py-2 text-xs leading-relaxed text-neutral-700 max-w-md">{r.scope_notes ?? "—"}</td>
        <td className="px-4 py-2 font-mono text-xs text-neutral-500">
          {new Date(r.updated_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short" })}
          {r.updated_by ? <div className="text-[10px] text-neutral-400">by {r.updated_by}</div> : null}
        </td>
        <td className="px-4 py-2 text-right">
          {canEdit ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline"
            >
              edit
            </button>
          ) : null}
        </td>
      </tr>
    );
  }

  // Edit mode: form inputs in the same cells.
  const editValue = r.unit === "percent" ? r.amount_cents.toString() : (r.amount_cents / 100).toFixed(2);
  const valuePrefix = r.unit === "percent" ? "%" : "$";

  return (
    <tr className="bg-amber-50/50">
      <td className="px-4 py-2 align-top">
        <div className="flex items-center gap-2">
          <span className="font-medium text-neutral-900">{r.display_name}</span>
          <Pill tone={categoryTone(r.category)}>{r.category}</Pill>
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-neutral-400">{r.rate_key}</div>
      </td>
      <td className="px-4 py-2 text-right align-top" colSpan={2}>
        <form action={updateRate} className="flex flex-wrap items-center justify-end gap-2">
          <input type="hidden" name="rate_key" value={r.rate_key} />
          <input type="hidden" name="unit" value={r.unit} />
          <label className="flex items-baseline gap-1 text-xs text-neutral-600">
            <span className="font-mono">{valuePrefix === "$" ? "$" : ""}</span>
            <input
              name="amount_dollars"
              type="number"
              step={r.unit === "percent" ? "1" : "0.01"}
              defaultValue={editValue}
              className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-right font-mono tabular-nums text-sm"
              required
            />
            <span className="font-mono">{valuePrefix === "%" ? "%" : (r.unit === "hour" ? "/hr" : "")}</span>
          </label>
          <textarea
            name="scope_notes"
            defaultValue={r.scope_notes ?? ""}
            placeholder="When to apply / scope notes (internal only)"
            rows={2}
            className="w-full max-w-md rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700"
          />
          <div className="flex gap-1">
            <SaveButton />
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
            >
              Cancel
            </button>
          </div>
        </form>
      </td>
      <td className="px-4 py-2 align-top font-mono text-xs text-neutral-500">
        {new Date(r.updated_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "short" })}
        {r.updated_by ? <div className="text-[10px] text-neutral-400">by {r.updated_by}</div> : null}
      </td>
      <td className="px-4 py-2" />
    </tr>
  );
}
