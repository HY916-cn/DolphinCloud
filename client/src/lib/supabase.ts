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
