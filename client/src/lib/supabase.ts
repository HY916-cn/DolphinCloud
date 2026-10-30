import { createClient } from '@supabase/supabase-js';

declare global {
  // Written by the container at start-up (docker/bin/dolphin-entrypoint) and loaded by public/index.html.
  interface Window { __DOLPHIN_CONFIG__?: { supabaseUrl: string; anonKey: string } }
}

// The API is served from the same origin as the app, so the client always talks to location.origin.
export const supabase = createClient(window.location.origin, window.__DOLPHIN_CONFIG__?.anonKey ?? '', {
  global: { headers: { 'X-Device-Id': deviceId() } },
});

// A stable id per browser, recorded on every transaction and audit entry.
function deviceId() {
  try {
    let id = localStorage.getItem('dolphin.device');
    if (!id) localStorage.setItem('dolphin.device', (id = crypto.randomUUID()));
    return id;
  } catch {
    return 'unknown';
  }
}

export const DEFAULT_PASSWORD = 'a12345678';
export type LoginKind = 'student' | 'staff';
export const loginEmail = (kind: LoginKind, loginId: string) => `${loginId.trim().toLowerCase()}@${kind}.dolphin.internal`;

// The API returns at most 1000 rows a request (PGRST_DB_MAX_ROWS); a school has up to 2000 students, so whole-roster
// reads go page by page. `page` must order by a unique key so the pages do not overlap.
const PAGE = 1000;
export async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data!);
    if (data!.length < PAGE) return rows;
  }
}
