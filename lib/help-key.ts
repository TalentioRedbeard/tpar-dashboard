// Normalize a literal pathname into a stable help key so dynamic routes share
// a single help entry instead of one per id:
//   '/comms'                -> '/comms'
//   '/job/abc123def456'     -> '/job/:id'
//   '/customer/8f3.../edit' -> '/customer/:id/edit'
//
// A segment is treated as an id when it's all digits, looks like a UUID, or is
// long and contains a digit (HCP job/customer ids). Plain route words like
// 'comms', 'admin', 'knowledge-gaps', 'view-as' are left untouched.

export function helpKeyForPath(pathname: string): string {
  const clean = (pathname || "/").split("?")[0].split("#")[0];
  const parts = clean.split("/").filter(Boolean);
  const norm = parts.map((seg) => {
    const isAllDigits = /^\d+$/.test(seg);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(seg);
    const isLongIdish = seg.length >= 12 && /\d/.test(seg);
    return isAllDigits || isUuid || isLongIdish ? ":id" : seg;
  });
  return "/" + norm.join("/");
}
