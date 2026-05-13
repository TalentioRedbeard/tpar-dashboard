import { PageLoading } from "../../components/Spinner";

export default function CustomersLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <PageLoading label="Loading customers…" subtitle="Pulling customer_360 + lifetime value." />
    </div>
  );
}
