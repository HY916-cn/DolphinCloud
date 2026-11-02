import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { rememberSession, renameAccount } from './accounts';
import { supabase, type LoginKind } from './supabase';

export type Role = 'teller' | 'accountant' | 'storekeeper' | 'teacher' | 'sysadmin';
export const ROLES: Record<Role, string> = { teller: '柜员', accountant: '会计', storekeeper: '库管', teacher: '银行管理员', sysadmin: '运维员' };
export type Profile = { id: string; login_kind: LoginKind; login_id: string; display_name: string; must_change_password: boolean; disabled: boolean };
export type Student = { student_no: string; name: string; division: 'primary' | 'junior'; cohort: number; class_no: number; class_label: string | null };
export type Me = { profile: Profile; roles: Role[]; student: Student | null };

const SessionContext = createContext<{ session: Session | null; ready: boolean }>({ session: null, ready: false });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ session: Session | null; ready: boolean }>({ session: null, ready: false });
  const queryClient = useQueryClient();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setState({ session: data.session, ready: true }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      // Every new or refreshed session is copied to this device's account list (lib/accounts.ts).
      if (session) rememberSession(session);
      setState({ session, ready: true });
      queryClient.invalidateQueries({ queryKey: ['me'] });
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);
  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);

// The last copy read is kept on the device, so a page reloaded without a network still knows who is signed in
// (the offline counter, PHASE-1.md §7.7). A fresh copy replaces it as soon as the server answers.
const meKey = (uid: string) => `dolphin.me:${uid}`;
function savedMe(uid: string | undefined): Me | undefined {
  try {
    return uid ? JSON.parse(localStorage.getItem(meKey(uid)) ?? 'null') ?? undefined : undefined;
  } catch {
    return undefined;
  }
}

// Who is signed in: profile, roles and (for a student login) the student record.
export function useMe() {
  const { session } = useSession();
  const uid = session?.user.id;
  return useQuery({
    queryKey: ['me', uid],
    enabled: !!uid,
    initialData: () => savedMe(uid),
    initialDataUpdatedAt: 0,
    queryFn: async (): Promise<Me> => {
      const [profile, roles, student] = await Promise.all([
        supabase.from('profiles').select('id,login_kind,login_id,display_name,must_change_password,disabled').eq('id', uid!).single(),
        supabase.from('user_roles').select('role').eq('user_id', uid!),
        supabase.from('students').select('student_no,name,division,cohort,class_no,class_label').eq('user_id', uid!).maybeSingle(),
      ]);
      if (profile.error) throw profile.error;
      if (roles.error) throw roles.error;
      if (student.error) throw student.error;
      renameAccount(uid!, profile.data.display_name);
      const me: Me = {
        profile: profile.data,
        roles: roles.data.map((r) => r.role as Role),
        student: (student.data as Student | null) ?? null,
      };
      try {
        localStorage.setItem(meKey(uid!), JSON.stringify(me));
      } catch {
        // Private mode: offline reloads are unavailable.
      }
      return me;
    },
  });
}

// Where a login works: each account has one identity (PHASE-1.md §4.1).
export function home(me: Me) {
  if (me.student) return '/student' as const;
  if (me.roles.includes('teller')) return '/counter' as const;
  if (me.roles.length) return '/admin' as const;
  return null;
}
