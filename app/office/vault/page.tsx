// /office/vault — the document vault. Files live in the private cfo-vault
// bucket (no public URLs ever); uploads go bucket-direct via signed upload
// URLs; views mint 10-minute signed links. First rescues: CP-575, the BA
// license, the Wagoner certificate, the lease, the insurance policies.

import { listDocuments } from "@/lib/office/actions";
import { VaultClient } from "./VaultClient";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  const res = await listDocuments();
  if (!res.ok) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">{res.error}</div>;
  }
  return <VaultClient docs={res.docs} />;
}
