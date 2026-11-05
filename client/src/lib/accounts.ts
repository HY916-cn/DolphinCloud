import type { Session } from '@supabase/supabase-js';
import { dropRoster } from './offline-queue';
import { keepSession, loginEmail, supabase, type LoginKind } from './supabase';

// The accounts signed in on this device (PHASE-1.md §7.4). One saved on this device keeps its latest session, so
// switching to it needs no password; one not saved keeps none here, and its active session lasts only until the tab
// or app is closed (lib/supabase.ts storage). The active account's session is kept fresh by supabase-js; every change
// is copied here by SessionProvider.
export type SavedAccount = {
  id: string; kind: LoginKind; loginId: string; name: string; saved: boolean;
  session: { access_token: string; refresh_token: string } | null;
};

const KEY = 'dolphin.accounts';

export function savedAccounts(): SavedAccount[] {
  try {
    // Accounts remembered before 在此设备保存登录 existed were all saved; one not saved keeps no session.
    return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedAccount[]).map((a) => {
      const saved = a.saved ?? true;
      return { ...a, saved, session: saved ? a.session : null };
    });
  } catch {
    return [];
  }
}

function store(list: SavedAccount[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Private mode: switching is unavailable, signing in still works.
  }
}

// Logins are <id>@<student|staff>.dolphin.internal (lib/supabase.ts loginEmail).
export function rememberSession(session: Session, name?: string) {
  const [loginId, domain] = (session.user.email ?? '').split('@');
  const old = savedAccounts().find((a) => a.id === session.user.id);
  const saved = old?.saved ?? false;
  const entry: SavedAccount = {
    id: session.user.id,
    kind: domain?.startsWith('staff') ? 'staff' : 'student',
    loginId,
    name: name ?? old?.name ?? loginId,
    saved,
    session: saved ? { access_token: session.access_token, refresh_token: session.refresh_token } : null,
  };
  // Kept in the order first signed in; a known account is updated in place.
  store(old ? savedAccounts().map((a) => (a.id === entry.id ? entry : a)) : [...savedAccounts(), entry]);
}

export function renameAccount(id: string, name: string) {
  store(savedAccounts().map((a) => (a.id === id && a.name !== name ? { ...a, name } : a)));
}

// What the app keeps for an account besides its session (who it is, the open duty) is stored where the session is:
// on the device for an account saved here, until the tab is closed otherwise.
const KEPT = (id: string) => [`dolphin.me:${id}`, `dolphin.duty:${id}`];
export function keptStorage(id: string): Storage {
  return savedAccounts().find((a) => a.id === id)?.saved ? localStorage : sessionStorage;
}
export function readKept(key: string) {
  try {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeKept(id: string, key: string, value: string) {
  try {
    const keep = keptStorage(id);
    keep.setItem(key, value);
    (keep === localStorage ? sessionStorage : localStorage).removeItem(key);
  } catch {
    // Private mode: offline reloads are unavailable.
  }
}
function moveKept(id: string) {
  for (const key of KEPT(id)) {
    const value = readKept(key);
    if (value !== null) writeKept(id, key, value);
  }
}

// 在此设备保存登录: whether this account stays signed in on this device, and switching back to it needs no password.
export async function setSaved(id: string, saved: boolean) {
  store(savedAccounts().map((a) => (a.id === id ? { ...a, saved, session: null } : a)));
  moveKept(id);
  keepSession();
  const { data } = await supabase.auth.getSession();
  if (saved && data.session?.user.id === id) rememberSession(data.session);
}

export function forgetAccount(id: string) {
  store(savedAccounts().filter((a) => a.id !== id));
  dropRoster(id).catch(() => {});
  for (const key of KEPT(id)) {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      // Nothing was kept.
    }
  }
}

// Forgets the accounts closed (注销) since they signed in here: a closed login never signs in again. Asked only while
// an account is signed in.
export async function dropClosed() {
  const ids = savedAccounts().map((a) => a.id);
  if (!ids.length || !(await supabase.auth.getSession()).data.session) return;
  const { data, error } = await supabase.rpc('closed_logins', { p_ids: ids });
  if (error) throw error;
  (data as string[]).forEach(forgetAccount);
}

const closed = async (id: string) => {
  await dropClosed().catch(() => {});
  return !savedAccounts().some((a) => a.id === id);
};

// Makes an account the active one: by its saved session, or with `password`. Answers null, 'password' (the account
// needs its password: not saved, or its session no longer works after a reset or a week unused), 'disabled' (the login
// was stopped), 'closed' (it was closed, and this device forgets it) or the Auth error code of a wrong password.
export async function switchAccount(id: string, password?: string): Promise<string | null> {
  const target = savedAccounts().find((a) => a.id === id);
  if (!target) return 'password';
  if (password) {
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(target.kind, target.loginId), password });
    if (error && (await closed(id))) return 'closed';
    return error ? (error.code === 'user_banned' ? 'disabled' : error.message.includes('LOGIN_LOCKED') ? 'LOGIN_LOCKED' : error.code ?? 'error') : null;
  }
  if (!target.session) return 'password';
  const { error } = await supabase.auth.setSession(target.session);
  if (!error) return null;
  if (await closed(id)) return 'closed';
  store(savedAccounts().map((a) => (a.id === id ? { ...a, session: null } : a)));
  return error.code === 'user_banned' ? 'disabled' : 'password';
}

// Checks the active account's password (turning off 在此设备保存登录); a right one also renews its session.
export async function checkPassword(id: string, password: string) {
  const target = savedAccounts().find((a) => a.id === id)!;
  const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(target.kind, target.loginId), password });
  return !error;
}

// Ends this device's session of the active account only and forgets it; the other accounts stay, to switch to.
export async function signOutCurrent() {
  const { data } = await supabase.auth.getSession();
  await supabase.auth.signOut({ scope: 'local' });
  if (data.session) forgetAccount(data.session.user.id);
}

// Ends this device's session of every remembered account and clears the list.
export async function signOutAll() {
  await supabase.auth.signOut({ scope: 'local' });
  for (const a of savedAccounts()) {
    if (a.session && (await switchAccount(a.id)) === null) await supabase.auth.signOut({ scope: 'local' });
  }
  savedAccounts().forEach((a) => forgetAccount(a.id));
}
