// Server-side queries for /admin/usage. Reads dashboard_page_views via the
// service-role client. Not marked "use server" — imported only from a server
// component, no client-side invocation.
//
// Per-user-per-path rollups for the last 7 days. We deliberately keep the
// shape simple — the substrate is just (user_email, path, ts), and the page
// answers "who hits what, how often."

import { db } from "@/lib/supabase";
import { getCurrentTech } from "@/lib/current-tech";

export type UserSummary = {
  user_email: string;
  total_views: number;
  distinct_days: number;
  distinct_paths: number;
  first_seen: string;
  last_seen: string;
  display_name: string | null;
  dashboard_role: string | null;
};

export type PathRow = {
  path: string;
  views: number;
  distinct_users: number;
  last_seen: string;
};

export type UserPathRow = {
  user_email: string;
  path: string;
  views: number;
  last_seen: string;
};

async function requireLeadership(): Promise<boolean> {
  const me = await getCurrentTech();
  return !!me && (me.isAdmin || me.isManager);
}

function rangeStart(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

// Last-N-day per-user totals + name/role joined from tech_directory.
export async function getUserSummary(days = 7): Promise<UserSummary[]> {
  if (!(await requireLeadership())) return [];
  const supabase = db();
  const since = rangeStart(days);

  const { data: rows } = await supabase
    .from("dashboard_page_views")
    .select("user_email, path, ts")
    .gte("ts", since)
    .order("ts", { ascending: false })
    .limit(20000);

  if (!rows || rows.length === 0) return [];

  const byUser = new Map<string, { count: number; days: Set<string>; paths: Set<string>; first: string; last: string }>();
  for (const r of rows as Array<{ user_email: string; path: string; ts: string }>) {
    const key = r.user_email;
    const dayKey = r.ts.slice(0, 10);
    const v = byUser.get(key);
    if (v) {
      v.count += 1;
      v.days.add(dayKey);
      v.paths.add(r.path);
      if (r.ts < v.first) v.first = r.ts;
      if (r.ts > v.last) v.last = r.ts;
    } else {
      byUser.set(key, {
        count: 1,
        days: new Set([dayKey]),
        paths: new Set([r.path]),
        first: r.ts,
        last: r.ts,
      });
    }
  }

  // Join tech_directory for display name + role.
  const emails = [...byUser.keys()];
  const { data: dirRows } = await supabase
    .from("tech_directory")
    .select("email, secondary_emails, hcp_full_name, dashboard_role")
    .or(emails.map((e) => `email.ilike.${e},secondary_emails.cs.{${e}}`).join(","));

  const dirByEmail = new Map<string, { name: string | null; role: string | null }>();
  for (const d of (dirRows ?? []) as Array<{
    email: string | null;
    secondary_emails: string[] | null;
    hcp_full_name: string | null;
    dashboard_role: string | null;
  }>) {
    if (d.email) dirByEmail.set(d.email.toLowerCase(), { name: d.hcp_full_name, role: d.dashboard_role });
    for (const s of d.secondary_emails ?? []) {
      dirByEmail.set(s.toLowerCase(), { name: d.hcp_full_name, role: d.dashboard_role });
    }
  }

  return [...byUser.entries()]
    .map(([email, v]) => {
      const dir = dirByEmail.get(email.toLowerCase());
      return {
        user_email: email,
        total_views: v.count,
        distinct_days: v.days.size,
        distinct_paths: v.paths.size,
        first_seen: v.first,
        last_seen: v.last,
        display_name: dir?.name ?? null,
        dashboard_role: dir?.role ?? null,
      };
    })
    .sort((a, b) => b.total_views - a.total_views);
}

// Per-path leaderboard for the same window.
export async function getPathLeaderboard(days = 7): Promise<PathRow[]> {
  if (!(await requireLeadership())) return [];
  const supabase = db();
  const since = rangeStart(days);

  const { data: rows } = await supabase
    .from("dashboard_page_views")
    .select("path, user_email, ts")
    .gte("ts", since)
    .order("ts", { ascending: false })
    .limit(20000);

  if (!rows) return [];

  const byPath = new Map<string, { views: number; users: Set<string>; last: string }>();
  for (const r of rows as Array<{ path: string; user_email: string; ts: string }>) {
    const v = byPath.get(r.path);
    if (v) {
      v.views += 1;
      v.users.add(r.user_email);
      if (r.ts > v.last) v.last = r.ts;
    } else {
      byPath.set(r.path, { views: 1, users: new Set([r.user_email]), last: r.ts });
    }
  }

  return [...byPath.entries()]
    .map(([path, v]) => ({
      path: normalizePath(path),
      views: v.views,
      distinct_users: v.users.size,
      last_seen: v.last,
    }))
    .reduce<PathRow[]>((acc, r) => {
      const existing = acc.find((x) => x.path === r.path);
      if (existing) {
        existing.views += r.views;
        existing.distinct_users = Math.max(existing.distinct_users, r.distinct_users);
        if (r.last_seen > existing.last_seen) existing.last_seen = r.last_seen;
      } else {
        acc.push(r);
      }
      return acc;
    }, [])
    .sort((a, b) => b.views - a.views);
}

// Per-user-per-path top paths for each user (top 5 paths each).
export async function getUserPathBreakdown(days = 7): Promise<UserPathRow[]> {
  if (!(await requireLeadership())) return [];
  const supabase = db();
  const since = rangeStart(days);

  const { data: rows } = await supabase
    .from("dashboard_page_views")
    .select("user_email, path, ts")
    .gte("ts", since)
    .order("ts", { ascending: false })
    .limit(20000);

  if (!rows) return [];

  const map = new Map<string, { views: number; last: string }>();
  for (const r of rows as Array<{ user_email: string; path: string; ts: string }>) {
    const key = `${r.user_email}\t${normalizePath(r.path)}`;
    const v = map.get(key);
    if (v) {
      v.views += 1;
      if (r.ts > v.last) v.last = r.ts;
    } else {
      map.set(key, { views: 1, last: r.ts });
    }
  }

  return [...map.entries()]
    .map(([key, v]) => {
      const [user_email, path] = key.split("\t");
      return { user_email, path, views: v.views, last_seen: v.last };
    })
    .sort((a, b) => b.views - a.views);
}

// Collapse dynamic ID segments so /job/12345 and /job/67890 are bucketed together.
// Heuristic: any path segment that's all-digits or a UUID gets replaced by [id].
function normalizePath(path: string): string {
  const parts = path.split("/").map((seg) => {
    if (/^\d+$/.test(seg)) return "[id]";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return "[uuid]";
    return seg;
  });
  return parts.join("/");
}
