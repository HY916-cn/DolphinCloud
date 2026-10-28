import type { Session } from '@supabase/supabase-js';
import { supabase, type LoginKind } from './supabase';

// The accounts signed in on this device (PHASE-1.md §7.4), each with its latest session, so switching needs no password.
// The active account's session is kept fresh by supabase-js; every change is copied here by SessionProvider.
export type SavedAccount = {
  id: string; kind: LoginKind; loginId: string; name: string;
  session: { access_token: string; refresh_token: string };
};

const KEY = 'dolphin.accounts';

export function savedAccounts(): SavedAccount[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
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
    session: { access_token: session.access_token, refresh_token: session.refresh_token },
  };
  // Kept in the order first signed in; a known account is updated in place.
  store(old ? savedAccounts().map((a) => (a.id === entry.id ? entry : a)) : [...savedAccounts(), entry]);
}

export function renameAccount(id: string, name: string) {
  store(savedAccounts().map((a) => (a.id === id && a.name !== name ? { ...a, name } : a)));
}

export function forgetAccount(id: string) {
  store(savedAccounts().filter((a) => a.id !== id));
}

// Makes a remembered account the active one. A session that no longer works (password reset, login disabled,
// unused for 7 days) is forgotten and reported, so the person signs in again.
export async function switchAccount(id: string) {
  const target = savedAccounts().find((a) => a.id === id);
  if (!target) return false;
  const { error } = await supabase.auth.setSession(target.session);
  if (error) forgetAccount(id);
  return !error;
}

// Ends this device's session of the active account only, forgets it, and moves to the next remembered account.
// Returns whether another account is now active.
export async function signOutCurrent() {
  const { data } = await supabase.auth.getSession();
  await supabase.auth.signOut({ scope: 'local' });
  if (data.session) forgetAccount(data.session.user.id);
  for (const next of savedAccounts()) {
    if (await switchAccount(next.id)) return true;
  }
  return false;
}

// Ends this device's session of every remembered account and clears the list.
export async function signOutAll() {
  await supabase.auth.signOut({ scope: 'local' });
  for (const a of savedAccounts()) {
    if (await switchAccount(a.id)) await supabase.auth.signOut({ scope: 'local' });
  }
  store([]);
}
