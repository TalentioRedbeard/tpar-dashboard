// Public hosted estimate view — /e/[token]. The token (from the Resend estimate
// email) is the entire auth; middleware exempts /e and resolveEstimateByToken()
// is the gate. force-dynamic so the token lookup + view log run on every load.

import { resolveEstimateByToken, logEstimateView } from "./actions";
import { PublicEstimateView } from "./PublicEstimateView";

export const dynamic = "force-dynamic";

function NeutralFallback() {
  // Constant-shape page for unknown / expired / revoked tokens — never reveals
  // whether the token ever existed.
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="text-xs font-bold uppercase tracking-wide text-brand-700">
        Tulsa Plumbing &amp; Remodeling
      </div>
      <h1 className="mt-2 text-xl font-semibold text-neutral-900">This estimate link is no longer active</h1>
      <p className="mt-2 text-sm leading-relaxed text-neutral-600">
        The link may have expired. For your current estimate, please call or text us at{" "}
        <a href="tel:+19188004426" className="font-semibold text-brand-700 hover:underline">
          (918) 800-4426
        </a>{" "}
        and we&rsquo;ll get it right back to you.
      </p>
    </main>
  );
}

export default async function HostedEstimatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const res = await resolveEstimateByToken(token);

  if (!res.ok) return <NeutralFallback />;

  // Log the view (best-effort; never blocks the render).
  await logEstimateView(res.sendId);

  return <PublicEstimateView estimate={res.estimate} />;
}
