import { useQuery } from '@tanstack/react-query';
import type { StaffKnown } from './staff-import';
import type { Role } from './session';
import { readAll, supabase } from './supabase';

// A staff login with its one role (PHASE-1.md §4.1). Closed logins (注销) are only in the records.
export type StaffLogin = {
  id: string; login_id: string; display_name: string; must_change_password: boolean; disabled: boolean; created_at: string;
  role: Role | null;
};

export function useStaff() {
  return useQuery({
    queryKey: ['admin-staff'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles')
        .select('id,login_id,display_name,must_change_password,disabled,created_at,user_roles(role)')
        .eq('login_kind', 'staff').is('closed_at', null).order('login_id');
      if (error) throw error;
      // user_roles is unique per login, so PostgREST embeds it as one row (or null).
      return (data as unknown as (Omit<StaffLogin, 'role'> & { user_roles: { role: Role } | null })[])
        .map(({ user_roles, ...p }) => ({ ...p, role: user_roles?.role ?? null }));
    },
  });
}

type KnownLogin = { id: string; login_id: string; disabled: boolean; closed_at: string | null; user_roles: { role: Role } | null };
type KnownStudent = { student_no: string; status: string };
type KnownBinding = { user_id: string; account: string };

// What the staff spreadsheet is checked against, read fresh: every staff login (closed ones too), student and binding.
export async function loadStaffKnown(): Promise<StaffKnown> {
  const [logins, students, bound] = await Promise.all([
    readAll<KnownLogin>((from, to) => supabase.from('profiles').select('id,login_id,disabled,closed_at,user_roles(role)').eq('login_kind', 'staff')
      .order('login_id').range(from, to) as unknown as PromiseLike<{ data: KnownLogin[] | null; error: unknown }>),
    readAll<KnownStudent>((from, to) => supabase.from('students').select('student_no,status')
      .order('student_no').range(from, to) as unknown as PromiseLike<{ data: KnownStudent[] | null; error: unknown }>),
    readAll<KnownBinding>((from, to) => supabase.from('staff_payroll').select('user_id,account').not('account', 'is', null)
      .order('user_id').range(from, to) as unknown as PromiseLike<{ data: KnownBinding[] | null; error: unknown }>),
  ]);
  return {
    logins: new Map(logins.map((p) => [p.login_id, { id: p.id, role: p.user_roles?.role ?? null, disabled: p.disabled, closed: p.closed_at !== null }])),
    students: new Map(students.map((s) => [s.student_no, s.status])),
    bound: new Map(bound.map((b) => [b.account, b.user_id])),
  };
}
