import { useQuery } from '@tanstack/react-query';
import { AppError } from './errors';
import { shiftDay } from './format';
import { call } from './rpc';
import { ratesOf, type PaidRole, type Rates, type Shift } from './salary';
import { supabase } from './supabase';

// 考勤与工资 (PHASE-1.md §6.9): one row per counted person and shift, with the identity it was signed under. A
// teller's shift counts once the bank admin confirms it; anyone else's is registered (登记), confirmed at once.
export type { Shift } from './salary';
export type ShiftStatus = 'pending' | 'confirmed' | 'rejected';
export type ShiftRow = {
  id: string; user_id: string; day: string; shift: Shift; status: ShiftStatus; signed_at: string; signed_by: string;
  note: string | null; salary_txn: string | null; pay: number | null; role: PaidRole; voided_at: string | null;
};
export type Payroll = { user_id: string; attendance: boolean; account: string | null; students: { name: string } | null };

export const SHIFTS: Record<Shift, string> = { am: '中午班', pm: '下午班' };
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
      let q = supabase.from('attendance').select('id,user_id,day,shift,status,signed_at,signed_by,note,salary_txn,pay,role,voided_at')
        .gte('day', from).lte('day', to).order('day').order('shift');
      if (userId) q = q.eq('user_id', userId);
      const { data, error } = await q;
      if (error) throw error;
      return data as ShiftRow[];
    },
  });
}

// Who is counted and where their pay goes: one's own row, or everyone's for the bank admin, the president and the
// sysadmin. The student's name is there for those who read students (not the storekeeper).
export async function readPayroll() {
  const { data, error } = await supabase.from('staff_payroll').select('user_id,attendance,account,students(name)');
  if (error) throw error;
  return data as unknown as Payroll[];
}

export function usePayroll() {
  return useQuery({ queryKey: ['payroll'], queryFn: readPayroll });
}

// 工资标准: the salary_rates table, readable by every login; null data while a cell is missing.
export function useSalaryRates() {
  return useQuery({
    queryKey: ['salary_rates'],
    queryFn: async (): Promise<Rates | null> => {
      const { data, error } = await supabase.from('salary_rates').select('role,shift,amount');
      if (error) throw error;
      return ratesOf(data);
    },
  });
}

// bind_salary_account answers a wrong password instead of raising it (the lockout count must stay).
export async function bindSalaryAccount(userId: string, studentNo: string, password: string | null) {
  const r = await call<{ error?: string; name?: string }>('bind_salary_account', { p_user_id: userId, p_student_no: studentNo, p_password: password });
  if (r.error) throw new AppError(r.error);
  return r;
}
