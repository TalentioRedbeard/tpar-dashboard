import { PageLoading } from "../../../components/Spinner";

export default function JobLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <PageLoading
        label="Loading job…"
        subtitle="Pulling job_360, customer info, line items, photos, comms."
      />
    </div>
  );
}
