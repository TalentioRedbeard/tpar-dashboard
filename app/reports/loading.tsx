import { PageLoading } from "../../components/Spinner";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <PageLoading label="Loading reports…" subtitle="Aggregating cross-table stats — this can take a few seconds." />
    </div>
  );
}
