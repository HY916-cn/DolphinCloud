import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { rememberSession, renameAccount } from './accounts';
import { supabase, type LoginKind } from './supabase';

export type Role = 'teller' | 'accountant' | 'storekeeper' | 'teacher' | 'sysadmin';
export type Profile = { id: string; login_kind: LoginKind; login_id: string; display_name: string; must_change_password: boolean };
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

// Who is signed in: profile, roles and (for a student login) the student record.
export function useMe() {
  const { session } = useSession();
  const uid = session?.user.id;
  return useQuery({
    queryKey: ['me', uid],
    enabled: !!uid,
    queryFn: async (): Promise<Me> => {
      const [profile, roles, student] = await Promise.all([
        supabase.from('profiles').select('id,login_kind,login_id,display_name,must_change_password').eq('id', uid!).single(),
        supabase.from('user_roles').select('role').eq('user_id', uid!),
        supabase.from('students').select('student_no,name,division,cohort,class_no,class_label').eq('user_id', uid!).maybeSingle(),
      ]);
      if (profile.error) throw profile.error;
      renameAccount(uid!, profile.data.display_name);
      return {
        profile: profile.data,
        roles: (roles.data ?? []).map((r) => r.role as Role),
        student: (student.data as Student | null) ?? null,
      };
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
