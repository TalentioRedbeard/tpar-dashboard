// /comms/new — quick send-text or queue-callback form.
//
// Supports query-string pre-fill:
//   ?to=<phone>            — pre-fill recipient
//   ?customer=<hcp_id>     — attach to customer
//   ?job=<hcp_job_id>      — attach to job (also implies customer if known)
//   ?type=customer|vendor|other — recipient type tag
//   ?body=<text>           — pre-fill body
//
// All sends land in communication_events for context.

import { redirect } from "next/navigation";
import { PageShell } from "../../../components/PageShell";
import { db } from "../../../lib/supabase";
import { getCurrentTech } from "../../../lib/current-tech";
import { loadBusinessContacts } from "../../../lib/business-contacts-actions";
import { ComposeForm } from "./ComposeForm";

export const metadata = { title: "Send · TPAR-DB" };
export const dynamic = "force-dynamic";

export default async function NewCommsPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string; customer?: string; job?: string; type?: string; body?: string }>;
}) {
  const me = await getCurrentTech();
  if (!me) redirect("/login?from=/comms/new");
  if (!me.isAdmin && me.dashboardRole !== "tech" && !me.isManager) redirect("/me");

  const sp = await searchParams;
  const supa = db();

  // Business contact list (techs / vendors / distributors) for the recipient
  // picker — so a writer can text any of them without hand-typing a number.
  const contacts = await loadBusinessContacts();

  // If we have a customer id, look up the name + phone for display
  let customerLabel: string | null = null;
  let customerPhone: string | null = null;
  if (sp.customer) {
    const { data } = await supa
      .from("customers_master")
      .select("name, phone_mobile10, phone10, phone_work10, phone_home10")
      .eq("hcp_customer_id", sp.customer)
      .maybeSingle();
    if (data) {
      customerLabel = (data.name as string | null) ?? null;
      // Prefer mobile → primary → work → home
      const phone10 = (data.phone_mobile10 as string | null)
                  ?? (data.phone10 as string | null)
                  ?? (data.phone_work10 as string | null)
                  ?? (data.phone_home10 as string | null);
      customerPhone = phone10 ?? null;  // ComposeForm normalizer handles 10-digit
    }
  }

  // If we have a job id, look up the customer for label too
  let jobLabel: string | null = null;
  if (sp.job) {
    const { data: jobRow } = await supa
      .from("hcp_jobs_raw")
      .select("hcp_customer_id, raw")
      .eq("hcp_job_id", sp.job)
      .maybeSingle();
    if (jobRow) {
      const raw = (jobRow.raw ?? {}) as Record<string, unknown>;
      const cust = (raw.customer ?? {}) as Record<string, unknown>;
      const inv = (raw.invoice_number ?? "") as string;
      const first = typeof cust.first_name === "string" ? cust.first_name : "";
      const last = typeof cust.last_name === "string" ? cust.last_name : "";
      jobLabel = `${first} ${last}`.trim() + (inv ? ` (inv ${inv})` : "");
    }
  }

  return (
    <PageShell
      title="Send"
      description="Text a number or queue a callback. Both land in customer 360 + /ask."
      help={{
        intent: "Send a text or queue Danny for a phone callback. Both ways, the comm is saved so the AI knows about it next time you ask /ask.",
        actions: [
          "Pick mode: Text now (Twilio SMS) or Queue call (you get a Twilio call later with the context, then you call them).",
          "Recipient: type the number, or it's pre-filled if you came from /customer or /me.",
          "Attach to customer/job: optional, but threads the comm into that record. Pre-filled when you came from those pages.",
        ],
      }}
    >
      <ComposeForm
        defaultTo={sp.to ?? customerPhone ?? ""}
        defaultBody={sp.body ?? ""}
        defaultRecipientType={sp.type ?? (sp.customer ? "customer" : "other")}
        hcpCustomerId={sp.customer ?? null}
        hcpJobId={sp.job ?? null}
        customerLabel={customerLabel}
        jobLabel={jobLabel}
        senderName={me.tech?.tech_short_name ?? ""}
        contacts={contacts}
      />
    </PageShell>
  );
}
