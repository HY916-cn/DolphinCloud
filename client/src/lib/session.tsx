import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
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
      return {
        profile: profile.data,
        roles: (roles.data ?? []).map((r) => r.role as Role),
        student: (student.data as Student | null) ?? null,
      };
    },
  });
}

// The places a login can work in, in the order the workspace chooser shows them.
export function destinations(me: Me) {
  const back = me.roles.some((r) => r !== 'teller');
  return [
    ...(me.roles.includes('teller') ? (['/counter'] as const) : []),
    ...(back ? (['/admin'] as const) : []),
    ...(me.student ? (['/student'] as const) : []),
  ];
}
