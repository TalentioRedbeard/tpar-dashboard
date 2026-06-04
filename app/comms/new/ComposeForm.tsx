"use client";

import { useState, useActionState } from "react";
import { sendComms, type SendResult, type SendMode } from "./actions";
import type { BusinessContact } from "../../../lib/business-contacts-actions";

const INITIAL_STATE: SendResult = { ok: false, message: "" };

export function ComposeForm({
  defaultTo,
  defaultBody,
  defaultRecipientType,
  hcpCustomerId,
  hcpJobId,
  customerLabel,
  jobLabel,
  senderName,
  contacts,
}: {
  defaultTo: string;
  defaultBody: string;
  defaultRecipientType: string;
  hcpCustomerId: string | null;
  hcpJobId: string | null;
  customerLabel: string | null;
  jobLabel: string | null;
  senderName: string;
  contacts: BusinessContact[];
}) {
  const [mode, setMode] = useState<SendMode>("sms");
  const [to, setTo] = useState(defaultTo);
  const [body, setBody] = useState(defaultBody);
  const [recipientType, setRecipientType] = useState(defaultRecipientType);
  const [fireAt, setFireAt] = useState("");  // empty = ASAP
  const [state, formAction, pending] = useActionState(sendComms, INITIAL_STATE);

  // ── Contact picker (techs / vendors / distributors) ──────────────────────
  const [contactQuery, setContactQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<{ name: string; optedOut: boolean } | null>(null);

  const filteredContacts = contactQuery.trim()
    ? contacts.filter((c) => {
        const q = contactQuery.trim().toLowerCase();
        return c.name.toLowerCase().includes(q) || c.subtitle.toLowerCase().includes(q) || c.phoneE164.includes(q);
      })
    : contacts;

  function pickContact(c: BusinessContact) {
    setTo(c.phoneE164);
    setRecipientType(c.recipientType);
    setSelected({ name: c.name, optedOut: c.optedOut });
    setPickerOpen(false);
    setContactQuery("");
  }

  // Reads as the signed-in operator, not hardcoded "Danny".
  const greeting = senderName ? `Hi, this is ${senderName} with Tulsa Plumbing.` : "Hi, this is Tulsa Plumbing.";

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="hcp_customer_id" value={hcpCustomerId ?? ""} />
      <input type="hidden" name="hcp_job_id" value={hcpJobId ?? ""} />

      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("sms")}
          className={`flex-1 rounded-lg border p-3 text-sm font-medium transition ${
            mode === "sms"
              ? "border-brand-400 bg-brand-50 text-brand-900"
              : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
          }`}
        >
          💬 Text now
        </button>
        <button
          type="button"
          onClick={() => setMode("call")}
          className={`flex-1 rounded-lg border p-3 text-sm font-medium transition ${
            mode === "call"
              ? "border-violet-400 bg-violet-50 text-violet-900"
              : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
          }`}
        >
          📞 Queue call (you call back)
        </button>
      </div>

      {/* Attached context (read-only summary) */}
      {(customerLabel || jobLabel) && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          {customerLabel ? <div><span className="font-medium">Customer:</span> {customerLabel}</div> : null}
          {jobLabel ? <div><span className="font-medium">Job:</span> {jobLabel}</div> : null}
          {!customerLabel && !jobLabel ? null : (
            <div className="mt-1 text-emerald-700">
              Comm will thread into this record.
            </div>
          )}
        </div>
      )}

      {/* Contact picker — techs / vendors / distributors (Slice 1) */}
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          className="flex w-full items-center justify-between text-xs font-medium uppercase tracking-wide text-neutral-600"
        >
          <span>📇 Pick a contact{contacts.length ? ` (${contacts.length})` : ""}</span>
          <span className="text-neutral-400">{pickerOpen ? "▲" : "▼"}</span>
        </button>
        {pickerOpen && (
          <div className="mt-2 space-y-2">
            <input
              type="text"
              value={contactQuery}
              onChange={(e) => setContactQuery(e.target.value)}
              placeholder="Search techs, vendors, distributors…"
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            />
            <div className="max-h-56 overflow-y-auto rounded-md border border-neutral-200 bg-white">
              {filteredContacts.length === 0 ? (
                <div className="px-3 py-2 text-xs text-neutral-500">
                  {contacts.length === 0 ? "No business contacts have a phone number yet." : "No matching contacts."}
                </div>
              ) : (
                filteredContacts.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => pickContact(c)}
                    className="flex w-full items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-brand-50"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-neutral-900">{c.name}</span>
                      <span className="ml-2 text-xs text-neutral-500">{c.subtitle}</span>
                    </span>
                    <span className="shrink-0 text-xs text-neutral-400">
                      {c.optedOut ? <span className="text-red-600">opted out</span> : c.phoneE164}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
        {selected && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
            <span className="rounded-full bg-brand-100 px-2 py-0.5 font-medium text-brand-800">{selected.name}</span>
            {selected.optedOut && mode === "sms" ? (
              <span className="text-red-600">⚠ opted out of texts — switch to a call or pick someone else</span>
            ) : null}
          </div>
        )}
      </div>

      {/* Recipient phone */}
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-600">
          {mode === "sms" ? "Send to" : "Vendor / contact phone"}
        </span>
        <input
          type="tel"
          name="to"
          required
          autoComplete="off"
          value={to}
          onChange={(e) => { setTo(e.target.value); if (selected) setSelected(null); }}
          placeholder="918-555-1234 or +19185551234"
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </label>

      {/* Recipient type */}
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-600">Who is this?</span>
        <select
          name="recipient_type"
          value={recipientType}
          onChange={(e) => setRecipientType(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        >
          <option value="customer">Customer (current or potential)</option>
          <option value="tech">Tech / staff</option>
          <option value="vendor">Vendor (Ferguson, Locke, Home Depot, etc.)</option>
          <option value="contractor">Contractor / sub</option>
          <option value="other">Other</option>
        </select>
      </label>

      {/* Body / context */}
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-600">
          {mode === "sms" ? "Message" : "Why are you calling? (read aloud when call fires)"}
        </span>
        <textarea
          name="body"
          required
          rows={mode === "sms" ? 5 : 3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            mode === "sms"
              ? `${greeting} About the…`
              : "Call Locke about the ETA on the 4-inch PVC sweep"
          }
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        {mode === "sms" && body.length > 0 && (
          <div className="mt-1 text-xs text-neutral-500">{body.length} chars · {Math.ceil(body.length / 160)} segments</div>
        )}
      </label>

      {/* Fire time for calls */}
      {mode === "call" && (
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-600">When to fire (blank = ASAP)</span>
          <input
            type="datetime-local"
            name="fire_at"
            value={fireAt}
            onChange={(e) => setFireAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <div className="mt-1 text-xs text-neutral-500">
            Cron dispatches every minute. Calls Danny&apos;s phone, reads context via TTS, you then call the vendor.
          </div>
        </label>
      )}

      <button
        type="submit"
        disabled={pending || (mode === "sms" && !!selected?.optedOut)}
        className={`w-full rounded-lg px-4 py-3 text-sm font-semibold text-white transition ${
          mode === "sms"
            ? "bg-brand-600 hover:bg-brand-700 disabled:bg-neutral-300"
            : "bg-violet-600 hover:bg-violet-700 disabled:bg-neutral-300"
        }`}
      >
        {pending ? "Sending…" : mode === "sms" ? "Send text" : "Queue call"}
      </button>

      {state.message && (
        <div
          className={`rounded-md border p-2 text-sm ${
            state.ok
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-red-300 bg-red-50 text-red-900"
          }`}
        >
          {state.message}
        </div>
      )}
    </form>
  );
}
