"use client";

// Generic client-side CSV download — builds a CSV from headers + rows and
// triggers a browser download. No server route needed (uses already-loaded data).

export function DownloadCsvButton({
  headers,
  rows,
  filename,
  label = "⬇ Download CSV",
}: {
  headers: string[];
  rows: Array<Array<string | number | null>>;
  filename: string;
  label?: string;
}) {
  function download() {
    const esc = (v: string | number | null) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <button
      type="button"
      onClick={download}
      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
    >
      {label}
    </button>
  );
}
