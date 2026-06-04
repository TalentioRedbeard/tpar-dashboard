// /contacts — vendor / sub / utility / agency / emergency directory.
//
// Backs ask-tpar's field_support intent. Read-only browse for v1; add/edit
// surfaces (and the "Log note to mgmt" + /admin/knowledge-gaps companion)
// will land in follow-up.

import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "../../lib/supabase";
import { PageShell } from "../../components/PageShell";
import { getCurrentTech } from "../../lib/current-tech";
import { ContactEditor, type ContactInitial } from "./ContactEditor";

export const metadata = { title: "Contacts · TPAR-DB" };
export const dynamic = "force-dynamic";

type Contact = {
  id: string;
  name: string;
  kind: string;
  category_tags: string[];
  phone_e164: string | null;
  alt_phone: string | null;
  email: string | null;
  website: string | null;
  when_to_call: string | null;
  notes: string | null;
  products_services: string[];
  is_preferred: boolean;
  is_competitor: boolean;
  status: string;
  use_count: number;
  last_used_at: string | null;
};

const KIND_LABELS: Record<string, { label: string; emoji: string; tone: string }> = {
  vendor:           { label: "Vendor",         emoji: "🏬", tone: "bg-emerald-50 border-emerald-200 text-emerald-900" },
  subcontractor:    { label: "Subcontractor",  emoji: "🤝", tone: "bg-sky-50 border-sky-200 text-sky-900" },
  utility:          { label: "Utility",        emoji: "🔧", tone: "bg-amber-50 border-amber-200 text-amber-900" },
  agency:           { label: "Agency",         emoji: "🏛️", tone: "bg-violet-50 border-violet-200 text-violet-900" },
  emergency:        { label: "Emergency",      emoji: "🚨", tone: "bg-red-50 border-red-200 text-red-900" },
  pricing_source:   { label: "Pricing source", emoji: "💵", tone: "bg-neutral-50 border-neutral-200 text-neutral-900" },
  supply:           { label: "Supply",         emoji: "📦", tone: "bg-emerald-50 border-emerald-200 text-emerald-900" },
  competitor:       { label: "Competitor",     emoji: "⚠️", tone: "bg-rose-50 border-rose-200 text-rose-900" },
  other:            { label: "Other",          emoji: "📇", tone: "bg-neutral-50 border-neutral-200 text-neutral-900" },
};

function formatPhone(e164: string | null): string {
  if (!e164) return "—";
  // +19185551234 → (918) 555-1234
  const m = e164.match(/^\+1?(\d{3})(\d{3})(\d{4})$/);
  if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  return e164;
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/contacts");
  // Curation (add/edit) is leadership-only; tap-to-call/text stays open to all.
  const canEdit = !!me.isAdmin || !!me.isManager;
  const editId = ((await searchParams).edit ?? "").trim();

  // Greeting for the "text via /comms" deep-link — reads as the signed-in
  // operator, not hardcoded "Danny" (re-point for Madisson + team).
  const senderGreeting = me.tech?.tech_short_name
    ? `Hi, this is ${me.tech.tech_short_name} with Tulsa Plumbing. `
    : "Hi, this is Tulsa Plumbing. ";

  const supa = db();
  const { data } = await supa
    .from("tpar_contacts")
    .select("*")
    .neq("status", "inactive")
    .order("is_preferred", { ascending: false })
    .order("kind")
    .order("name");

  const contacts = (data ?? []) as Contact[];

  // Pre-fill the editor when navigated to with ?edit=<id> (the per-card link).
  const editInitial: ContactInitial | null =
    canEdit && editId
      ? (() => {
          const c = contacts.find((x) => x.id === editId);
          if (!c) return null;
          return {
            id: c.id, name: c.name, kind: c.kind, phone_e164: c.phone_e164,
            alt_phone: c.alt_phone, email: c.email, website: c.website,
            when_to_call: c.when_to_call, notes: c.notes,
            category_tags: c.category_tags, status: c.status, is_preferred: c.is_preferred,
          };
        })()
      : null;

  // Group by kind
  const byKind = new Map<string, Contact[]>();
  for (const c of contacts) {
    const arr = byKind.get(c.kind) ?? [];
    arr.push(c);
    byKind.set(c.kind, arr);
  }
  const orderedKinds: string[] = ["emergency", "utility", "agency", "subcontractor", "vendor", "supply", "pricing_source", "competitor", "other"];
  const kindsPresent = orderedKinds.filter((k) => byKind.has(k));

  return (
    <PageShell
      title="Contacts"
      description={`${contacts.length} active contact${contacts.length === 1 ? "" : "s"} · ask /ask "who do I call for X" to find them automatically`}
      help={{
        intent: "Phone book for vendors, subs, utilities, agencies, emergencies. Read by /ask when you ask 'who do I call about X'. Tap-to-call any number from your phone.",
        actions: [
          "Tap any phone number to call from your phone (mobile).",
          "Click 'Text via /comms' to send a Twilio SMS with the number pre-filled.",
          "Each section is collapsible — emergencies are pinned at the top.",
          "Need to add a contact? Today: SQL or ask Danny. CRUD UI in a follow-up slice.",
        ],
        stuck: <>Don&apos;t see who you&apos;re looking for? Ask /ask anyway — it&apos;ll log a knowledge gap and Danny will add the contact.</>,
      }}
    >
      {canEdit ? <ContactEditor key={editInitial?.id ?? "new"} initial={editInitial} /> : null}
      <div className="space-y-6">
        {kindsPresent.map((kind) => {
          const items = byKind.get(kind) ?? [];
          const meta = KIND_LABELS[kind] ?? KIND_LABELS.other;
          return (
            <section key={kind}>
              <h2 className="mb-2 flex items-baseline gap-2 text-base font-semibold text-neutral-900">
                <span>{meta.emoji}</span>
                <span>{meta.label}</span>
                <span className="text-xs font-normal text-neutral-500">{items.length} item{items.length === 1 ? "" : "s"}</span>
              </h2>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {items.map((c) => (
                  <ContactCard key={c.id} c={c} senderGreeting={senderGreeting} canEdit={canEdit} />
                ))}
              </div>
            </section>
          );
        })}
        {contacts.length === 0 && (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
            No contacts yet. Seed should have populated 12 — check the migration ran.
          </div>
        )}
      </div>
    </PageShell>
  );
}

function ContactCard({ c, senderGreeting, canEdit }: { c: Contact; senderGreeting: string; canEdit: boolean }) {
  const meta = KIND_LABELS[c.kind] ?? KIND_LABELS.other;
  const phoneRaw10 = c.phone_e164 ? c.phone_e164.replace(/^\+1/, "") : null;
  return (
    <div className={`rounded-xl border p-3 text-sm ${meta.tone} ${c.status === "research_candidate" ? "border-dashed" : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-neutral-900">{c.name}</span>
          {c.is_preferred ? <span className="rounded-md bg-yellow-200 px-1.5 py-0.5 text-[10px] font-medium text-yellow-900">⭐ preferred</span> : null}
          {c.is_competitor ? <span className="rounded-md bg-rose-200 px-1.5 py-0.5 text-[10px] font-medium text-rose-900">⚠ competitor</span> : null}
          {c.status === "research_candidate" ? <span className="rounded-md bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700">research candidate</span> : null}
        </div>
        {canEdit ? (
          <Link href={`/contacts?edit=${c.id}`} className="shrink-0 text-[10px] text-neutral-500 hover:underline" prefetch={false}>✏️ edit</Link>
        ) : null}
      </div>
      {c.phone_e164 ? (
        <div className="mt-1 flex flex-wrap items-baseline gap-2 text-xs">
          <a href={`tel:${c.phone_e164}`} className="font-mono font-medium text-neutral-900 underline hover:no-underline">
            📞 {formatPhone(c.phone_e164)}
          </a>
          {phoneRaw10 ? (
            <Link
              href={`/comms/new?to=${phoneRaw10}&type=${c.kind === "subcontractor" ? "contractor" : c.kind === "vendor" ? "vendor" : "other"}&body=${encodeURIComponent(senderGreeting)}`}
              className="rounded-md bg-white/60 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700 hover:bg-white"
            >
              💬 Text via /comms
            </Link>
          ) : null}
        </div>
      ) : null}
      {c.alt_phone ? (
        <div className="mt-0.5 text-xs">alt: <span className="font-mono">{c.alt_phone}</span></div>
      ) : null}
      {c.email ? (
        <div className="mt-0.5 text-xs"><a href={`mailto:${c.email}`} className="underline">{c.email}</a></div>
      ) : null}
      {c.website ? (
        <div className="mt-0.5 text-xs"><a href={c.website} target="_blank" rel="noopener" className="underline">{c.website.replace(/^https?:\/\//, "")}</a></div>
      ) : null}
      {c.when_to_call ? (
        <div className="mt-1 text-xs italic">When: {c.when_to_call}</div>
      ) : null}
      {c.notes ? (
        <div className="mt-1 text-xs text-neutral-700">{c.notes}</div>
      ) : null}
      {c.products_services.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {c.products_services.slice(0, 6).map((tag) => (
            <span key={tag} className="rounded bg-white/50 px-1.5 py-0.5 text-[9px] font-medium text-neutral-700">{tag}</span>
          ))}
        </div>
      ) : null}
      {c.use_count > 0 ? (
        <div className="mt-1 text-[10px] text-neutral-500">used {c.use_count}× · last {c.last_used_at ? new Date(c.last_used_at).toLocaleDateString() : "—"}</div>
      ) : null}
    </div>
  );
}
