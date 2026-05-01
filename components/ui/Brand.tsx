// Brand — TPAR wordmark with the company's colors. Pure SVG so it scales
// crisply at any size. Used in nav (small) and on the login page (large).

export function BrandMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="0" y="0" width="32" height="32" rx="7" className="fill-brand-700" />
      <path
        d="M9 10h14v3.2h-5.4V23h-3.2V13.2H9V10z"
        className="fill-white"
      />
      <circle cx="24" cy="22" r="2.6" className="fill-accent-500" />
    </svg>
  );
}

export function Wordmark({
  size = "md",
  showTagline = false,
}: {
  size?: "sm" | "md" | "lg";
  showTagline?: boolean;
}) {
  const tspan = size === "lg" ? "text-xl" : size === "sm" ? "text-sm" : "text-base";
  const mark = size === "lg" ? 36 : size === "sm" ? 22 : 26;
  return (
    <div className="flex items-center gap-2">
      <BrandMark size={mark} />
      <div className="leading-none">
        <div className={`font-semibold tracking-tight text-neutral-900 ${tspan}`}>
          TPAR<span className="text-brand-700">·</span>DB
        </div>
        {showTagline ? (
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
            Operations console
          </div>
        ) : null}
      </div>
    </div>
  );
}
