// TechName — render a tech's name, with a small "(former)" tag if they're
// no longer with the company. Use alongside getFormerTechNames() at the
// page level so the Set is fetched once per request.

export function TechName({
  name,
  formerSet,
  className = "",
}: {
  name: string | null | undefined;
  formerSet: Set<string>;
  className?: string;
}) {
  const n = name ?? "—";
  const isFormer = formerSet.has(n);
  if (!isFormer) return <span className={className}>{n}</span>;
  return (
    <span className={`${className} text-neutral-500`}>
      {n}
      <span className="ml-1 text-[10px] uppercase tracking-wide text-neutral-400">(former)</span>
    </span>
  );
}
