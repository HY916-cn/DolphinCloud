import { useQuery } from '@tanstack/react-query';
import type { Role } from './session';
import { supabase } from './supabase';

// A staff login with its one role (PHASE-1.md §4.1).
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
        .eq('login_kind', 'staff').order('login_id');
      if (error) throw error;
      // user_roles is unique per login, so PostgREST embeds it as one row (or null).
      return (data as unknown as (Omit<StaffLogin, 'role'> & { user_roles: { role: Role } | null })[])
        .map(({ user_roles, ...p }) => ({ ...p, role: user_roles?.role ?? null }));
    },
  });
}
