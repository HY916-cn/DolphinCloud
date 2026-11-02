import { useQuery } from '@tanstack/react-query';
import { AppError } from './errors';
import { shiftDay } from './format';
import { call } from './rpc';
import { supabase } from './supabase';

// 考勤与工资 (PHASE-1.md §6.9): one row per teller and shift; a shift counts once the bank admin confirms it.
export type Shift = 'am' | 'pm';
export type ShiftStatus = 'pending' | 'confirmed' | 'rejected';
export type ShiftRow = {
  id: string; user_id: string; day: string; shift: Shift; status: ShiftStatus; signed_at: string; signed_by: string;
  note: string | null; salary_txn: string | null; pay: number | null;
};
export type Payroll = { user_id: string; attendance: boolean; account: string | null; students: { name: string } | null };

export const SHIFTS: Record<Shift, string> = { am: '上午班', pm: '下午班' };
export const SHIFT_STATUS: Record<ShiftStatus, string> = { pending: '待审', confirmed: '有效', rejected: '未通过' };

// The Monday of the week holding a day, and its Sunday.
export const weekOf = (day: string): [string, string] => {
  const monday = shiftDay(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
  return [monday, shiftDay(monday, 6)];
};

export function useShifts(from: string, to: string, userId?: string) {
  return useQuery({
    queryKey: ['attendance', from, to, userId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('attendance').select('id,user_id,day,shift,status,signed_at,signed_by,note,salary_txn,pay')
        .gte('day', from).lte('day', to).order('day').order('shift');
      if (userId) q = q.eq('user_id', userId);
      const { data, error } = await q;
      if (error) throw error;
      return data as ShiftRow[];
    },
  });
}

// Who is counted and where their pay goes; the student's name is readable by the teller, and the bank admin.
export function usePayroll() {
  return useQuery({
    queryKey: ['payroll'],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff_payroll').select('user_id,attendance,account,students(name)');
      if (error) throw error;
      return data as unknown as Payroll[];
    },
  });
}

export function useSalaryRate() {
  return useQuery({
    queryKey: ['settings', 'salary_per_shift'],
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('value').eq('key', 'salary_per_shift').single();
      if (error) throw error;
      return data.value as number;
    },
  });
}

// What confirmed shifts pay: their own pay once paid, the current rate until then.
export const earned = (rows: ShiftRow[], rate: number) =>
  rows.filter((r) => r.status === 'confirmed').reduce((s, r) => s + (r.pay ?? rate), 0);

// bind_salary_account answers a wrong password instead of raising it (the lockout count must stay).
export async function bindSalaryAccount(userId: string, studentNo: string, password: string) {
  const r = await call<{ error?: string; name?: string }>('bind_salary_account', { p_user_id: userId, p_student_no: studentNo, p_password: password });
  if (r.error) throw new AppError(r.error);
  return r;
}
