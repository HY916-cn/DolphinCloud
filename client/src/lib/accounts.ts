import type { Session } from '@supabase/supabase-js';
import { dropRoster } from './offline-queue';
import { loginEmail, supabase, type LoginKind } from './supabase';

// The accounts signed in on this device (PHASE-1.md §7.4). One saved on this device keeps its latest session, so
// switching to it needs no password; one not saved keeps its session only while it is the active account. The active
// account's session is kept fresh by supabase-js; every change is copied here by SessionProvider.
export type SavedAccount = {
  id: string; kind: LoginKind; loginId: string; name: string; saved: boolean;
  session: { access_token: string; refresh_token: string } | null;
};

const KEY = 'dolphin.accounts';

export function savedAccounts(): SavedAccount[] {
  try {
    // Accounts remembered before 在此设备保存登录 existed were all saved.
    return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedAccount[]).map((a) => ({ ...a, saved: a.saved ?? true }));
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
  const entry: SavedAccount = {
    id: session.user.id,
    kind: domain?.startsWith('staff') ? 'staff' : 'student',
    loginId,
    name: name ?? old?.name ?? loginId,
    saved: old?.saved ?? false,
    session: { access_token: session.access_token, refresh_token: session.refresh_token },
  };
  // Kept in the order first signed in; a known account is updated in place.
  store(old ? savedAccounts().map((a) => (a.id === entry.id ? entry : a)) : [...savedAccounts(), entry]);
}

export function renameAccount(id: string, name: string) {
  store(savedAccounts().map((a) => (a.id === id && a.name !== name ? { ...a, name } : a)));
}

// 在此设备保存登录: whether switching back to this account needs its password.
export function setSaved(id: string, saved: boolean) {
  store(savedAccounts().map((a) => (a.id === id ? { ...a, saved } : a)));
}

export function forgetAccount(id: string) {
  store(savedAccounts().filter((a) => a.id !== id));
  dropRoster(id).catch(() => {});
  try {
    localStorage.removeItem(`dolphin.me:${id}`);
  } catch {
    // Nothing was kept.
  }
}

// The active account leaves its session behind only when it is saved on this device.
function leave() {
  const active = savedAccounts().find((a) => a.session && !a.saved);
  if (active) store(savedAccounts().map((a) => (a.id === active.id ? { ...a, session: null } : a)));
}

// Makes an account the active one: by its saved session, or with `password`. Answers null, 'password' (the account
// needs its password: not saved, or its session no longer works after a reset or a week unused), 'disabled' (the login
// was stopped) or the Auth error code of a wrong password.
export async function switchAccount(id: string, password?: string): Promise<string | null> {
  const target = savedAccounts().find((a) => a.id === id);
  if (!target) return 'password';
  if (password) {
    leave();
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(target.kind, target.loginId), password });
    return error ? (error.code === 'user_banned' ? 'disabled' : error.message.includes('LOGIN_LOCKED') ? 'LOGIN_LOCKED' : error.code ?? 'error') : null;
  }
  if (!target.session) return 'password';
  leave();
  const { error } = await supabase.auth.setSession(target.session);
  if (!error) return null;
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
