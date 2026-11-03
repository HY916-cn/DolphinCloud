import { createClient } from '@supabase/supabase-js';

declare global {
  // Written by the container at start-up (docker/bin/dolphin-entrypoint) and loaded by public/index.html.
  interface Window { __DOLPHIN_CONFIG__?: { supabaseUrl: string; anonKey: string } }
}

// 在此设备保存登录 (lib/accounts.ts): a saved account's session is kept in localStorage, across restarts; any other
// only in sessionStorage, so closing the tab, the browser or the home-screen app signs it out.
function savedHere(session: string) {
  try {
    const id = (JSON.parse(session) as { user?: { id?: string } }).user?.id;
    // Read here rather than through lib/accounts.ts, which imports this file. Accounts from before the choice are saved.
    const list = JSON.parse(localStorage.getItem('dolphin.accounts') ?? '[]') as { id: string; saved?: boolean }[];
    return list.some((a) => a.id === id && (a.saved ?? true));
  } catch {
    return false;
  }
}
// supabase-js's default key, kept so sessions stored before stay signed in.
const storageKey = `sb-${window.location.hostname.split('.')[0]}-auth-token`;
const storage = {
  getItem: (key: string) => sessionStorage.getItem(key) ?? localStorage.getItem(key),
  setItem: (key: string, value: string) => {
    const [keep, drop] = savedHere(value) ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
    keep.setItem(key, value);
    drop.removeItem(key);
  },
  removeItem: (key: string) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};

// The API is served from the same origin as the app, so the client always talks to location.origin.
export const supabase = createClient(window.location.origin, window.__DOLPHIN_CONFIG__?.anonKey ?? '', {
  global: { headers: { 'X-Device-Id': deviceId() } },
  auth: { storage, storageKey },
});

// Moves the active session to where 在此设备保存登录 now says; also run once at start for sessions stored before.
export function keepSession() {
  try {
    const value = storage.getItem(storageKey);
    if (value) storage.setItem(storageKey, value);
  } catch {
    // Private mode: nothing is kept.
  }
}
keepSession();

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
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}
