import { useQuery } from '@tanstack/react-query';
import { indexRoster } from './search';
import { readAll, supabase } from './supabase';

// One student as the back office lists them. A sysadmin reads no balances (accounts is null for them, PHASE-1.md §6.6).
export type AdminStudent = {
  student_no: string; name: string; division: 'primary' | 'junior'; cohort: number; class_no: number; class_label: string | null;
  status: 'normal' | 'frozen' | 'graduated' | 'closed'; user_id: string; opened_at: string;
  accounts: { balance: number } | null; profiles: { must_change_password: boolean; disabled: boolean } | null;
};
const COLUMNS = 'student_no,name,division,cohort,class_no,class_label,status,user_id,opened_at,accounts(balance),profiles(must_change_password,disabled)';

export const STATUS = { normal: '正常', frozen: '已冻结', graduated: '已毕业', closed: '已注销' } as const;
export const DIVISION = { primary: '小学部', junior: '初中部' } as const;

// The whole roster by grade (小学部 then 初中部, lowest grade first), indexed for search (lib/search.ts); closed
// accounts (注销) are only in the records.
export function useStudents() {
  return useQuery({
    queryKey: ['admin-students'],
    queryFn: async () => {
      const rows = await readAll<AdminStudent>((from, to) => supabase.from('students').select(COLUMNS).neq('status', 'closed')
        .order('division', { ascending: false }).order('cohort', { ascending: false }).order('class_no').order('student_no')
        .range(from, to) as unknown as PromiseLike<{ data: AdminStudent[] | null; error: unknown }>);
      return { rows, index: indexRoster(rows) };
    },
  });
}

export function useStudent(no: string) {
  return useQuery({
    queryKey: ['admin-students', no],
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select(COLUMNS).eq('student_no', no).maybeSingle();
      if (error) throw error;
      return data as unknown as AdminStudent | null;
    },
  });
}
