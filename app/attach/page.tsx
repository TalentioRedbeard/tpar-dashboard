// /attach — forward-to-attach queue. Leadership (admin/manager) forward a
// client email to ddunlop+attach@tulsapar.com and attach it here to a customer
// (and optionally a job) without anyone browsing the owner's inbox.

import { redirect } from "next/navigation";
import { PageShell } from "../../components/PageShell";
import { AttachQueue } from "../../components/AttachQueue";
import { getCurrentTech } from "../../lib/current-tech";
import { listAttachQueue } from "./actions";

export const metadata = { title: "Attach · TPAR-DB" };
export const dynamic = "force-dynamic";

export default async function AttachPage() {
  const me = await getCurrentTech().catch(() => null);
  if (!me || !(me.isAdmin || me.isManager)) redirect("/");

  const queue = await listAttachQueue();

  return (
    <PageShell
      kicker="Email"
      title="Attach queue"
      description={
        queue.length > 0
          ? `${queue.length} forwarded email${queue.length === 1 ? "" : "s"} waiting to attach.`
          : "Forwarded client emails waiting to attach to a customer or job."
      }
      help={{
        intent: "Attach client emails to a customer or job — without anyone browsing the owner's inbox.",
        actions: [
          "Forward a client email to ddunlop+attach@tulsapar.com",
          "It shows up here within a few minutes",
          "Pick the customer (and job), set who can see it, add a handling note, then Attach",
          "Attached emails appear on the customer + job pages and the Job Briefing",
        ],
      }}
    >
      <div className="mb-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
        Forward any client email to{" "}
        <code className="rounded bg-white px-1.5 py-0.5 font-mono text-neutral-800 ring-1 ring-inset ring-neutral-200">
          ddunlop+attach@tulsapar.com
        </code>{" "}
        and it lands here. Your inbox stays private — only what&apos;s forwarded shows up.
      </div>
      <AttachQueue initial={queue} />
    </PageShell>
  );
}
