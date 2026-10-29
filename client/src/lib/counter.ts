import { useQuery } from '@tanstack/react-query';
import type { Counts } from './cash';
import { AppError } from './errors';
import { cachedRoster, saveRoster } from './offline-queue';
import { setReachable } from './online';
import { indexRoster } from './search';
import { supabase } from './supabase';

// The counter's calls to the database functions (PHASE-1.md §6.2). A call that gets no answer within 5 seconds,
// or no answer at all, is a NETWORK error: the counter then treats itself as offline (§7.7).
export async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error, status } = await supabase.rpc(fn, args).abortSignal(AbortSignal.timeout(5000));
  setReachable(!!status);
  if (!error) return data as T;
  if (!status) throw new AppError('NETWORK');
  let detail = {};
  try {
    detail = JSON.parse(error.details ?? '{}') ?? {};
  } catch {
    // details is plain text for errors that are not ours.
  }
  throw new AppError(error.message, detail);
}

export type Student = {
  student_no: string; name: string; division: 'primary' | 'junior'; cohort: number; class_no: number;
  class_label: string | null; status: string; balance: number | null; withdrawn_today: number | null;
};
export type TxnResult = { id: string; txn_no: string; type: string; amount: number; balance_after: number; change_given: Counts | null; created_at: string };

export const lookupStudent = (no: string) => call<Student>('lookup_student', { p_student_no: no.trim() });
export const deposit = (id: string, no: string, cash: Counts, offline = false, at?: string) =>
  call<TxnResult>('deposit', { p_id: id, p_student_no: no, p_denominations: cash, p_offline: offline, p_client_created_at: at ?? null });
export const withdraw = (id: string, no: string, amount: number) =>
  call<TxnResult>('withdraw', { p_id: id, p_student_no: no, p_amount: amount });
export const purchase = (id: string, no: string, items: { product_id: string; qty: number }[], payment: 'account' | 'cash', received?: Counts) =>
  call<TxnResult>('purchase', { p_id: id, p_student_no: no, p_items: items, p_payment: payment, p_cash_received: received ?? null });
export const reverseTxn = (id: string, originalId: string, reason: string) =>
  call<TxnResult>('reverse_txn', { p_id: id, p_original_id: originalId, p_reason: reason });

export const classOf = (s: Pick<Student, 'class_label' | 'class_no'>) => s.class_label ?? `${s.class_no} 班`;

// Counter settings. The last copy read is kept on the device so the offline counter still knows the faces.
export type Settings = { denominations: number[]; single: Record<string, number>; daily: Record<string, number> };
const SETTINGS_KEY = 'dolphin.counter-settings';
const FALLBACK: Settings = { denominations: [1, 2, 5, 10], single: {}, daily: {} };

function savedSettings(): Settings {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') ?? FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export function useSettings() {
  return useQuery({
    queryKey: ['counter-settings'],
    initialData: savedSettings,
    initialDataUpdatedAt: 0,
    queryFn: async (): Promise<Settings> => {
      const { data, error } = await supabase.from('settings').select('key,value')
        .in('key', ['denominations', 'withdraw_single_limit', 'withdraw_daily_limit']);
      if (error) throw error;
      const v = Object.fromEntries(data.map((r) => [r.key, r.value]));
      const settings = { denominations: v.denominations, single: v.withdraw_single_limit, daily: v.withdraw_daily_limit };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        // Private mode: the counter falls back to the default faces when offline.
      }
      return settings;
    },
  }).data;
}

// The roster the counter searches (lib/search.ts). Each read is kept on this device; offline, or when the read gets
// no answer, the counter searches the copy kept there (§7.7).
export function useRoster(accountId: string) {
  return useQuery({
    queryKey: ['roster', accountId],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('student_no,name,class_no,class_label,status')
        .abortSignal(AbortSignal.timeout(5000));
      if (!error) await saveRoster(accountId, data);
      return indexRoster(error ? await cachedRoster(accountId) : data);
    },
  });
}

export const newId = () => crypto.randomUUID();
