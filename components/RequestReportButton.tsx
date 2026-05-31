"use client";

// Dispatch entry-point for Phase 3 reports. Generates an AI customer brief and
// navigates to the customer page (where the new report appears at top).

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { requestCustomerReport } from "../lib/customer-reports";

export function RequestReportButton({ hcpCustomerId }: { hcpCustomerId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState(false);
  if (!hcpCustomerId) return null;

  function go() {
    setErr(false);
    start(async () => {
      const r = await requestCustomerReport(hcpCustomerId as string);
      if (r.ok) router.push(`/customer/${hcpCustomerId}`);
      else setErr(true);
    });
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={pending}
      title={err ? "Report failed — click to retry" : "Generate an AI context brief for this customer"}
      className="rounded-md border border-brand-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
    >
      {pending ? "…" : err ? "⚠ report" : "📄 report"}
    </button>
  );
}
