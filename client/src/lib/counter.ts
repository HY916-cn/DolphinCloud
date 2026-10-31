import { useQuery } from '@tanstack/react-query';
import type { Counts } from './cash';
import { formatAmount } from './format';
import { cachedRoster, saveRoster } from './offline-queue';
import { call, withTimeout } from './rpc';
import { indexRoster } from './search';
import { readAll, supabase } from './supabase';

export type Student = {
  student_no: string; name: string; division: 'primary' | 'junior'; cohort: number; class_no: number;
  class_label: string | null; status: string; balance: number | null; withdrawn_today: number | null;
};
export type TxnResult = {
  id: string; txn_no: string; type: string; amount: number; balance_after: number; denominations: Counts | null;
  change_given: Counts | null; created_at: string;
};

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
// no answer, the counter searches the copy kept there (§7.7). Read again whenever the counter comes back into view,
// so students imported meanwhile can be found; an import on this device invalidates ['roster'] at once.
export function useRoster(accountId: string) {
  return useQuery({
    queryKey: ['roster', accountId],
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: 'always',
    queryFn: async () => {
      const data = await withTimeout(5000, (signal) => readAll((from, to) => supabase.from('students')
        .select('student_no,name,class_no,class_label,status').order('student_no').range(from, to).abortSignal(signal))).catch(() => null);
      if (data) await saveRoster(accountId, data);
      return indexRoster(data ?? await cachedRoster(accountId));
    },
  });
}

export const newId = () => crypto.randomUUID();

// Today's businesses of one teller, newest first (RLS shows a teller only their own day). 办理 offers the students
// served today again; 今日业务 lists every line with its 冲正.
export type DayTxn = {
  id: string; txn_no: string; type: 'deposit' | 'withdraw' | 'purchase' | 'reversal'; amount: number; balance_delta: number; payment: 'account' | 'cash' | null;
  status: 'normal' | 'reversed'; reason: string | null; created_at: string; student_no: string;
  students: { name: string; class_no: number; class_label: string | null; status: string } | null;
  txn_items: { name: string; qty: number }[];
};
export function useMyDay(operatorId: string, enabled = true) {
  return useQuery({
    queryKey: ['my-day', operatorId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('txns')
        .select('id,txn_no,type,amount,balance_delta,payment,status,reason,created_at,student_no,students(name,class_no,class_label,status),txn_items(name,qty)')
        .eq('operator_id', operatorId).in('type', ['deposit', 'withdraw', 'purchase', 'reversal']).order('seq', { ascending: false });
      if (error) throw error;
      return data as unknown as DayTxn[];
    },
  });
}

const BUSINESS = { deposit: '存款', withdraw: '取款', purchase: '兑换', reversal: '冲正' };
// "存款 22 HTB", "兑换 海豚书签 × 1（现金）".
export const describeTxn = (t: Pick<DayTxn, 'type' | 'amount' | 'payment' | 'txn_items'>) =>
  t.type === 'purchase' ? `兑换 ${t.txn_items.map((i) => `${i.name} × ${i.qty}`).join('、')}（${t.payment === 'cash' ? '现金' : '账户'}）`
  : `${BUSINESS[t.type]} ${formatAmount(t.amount)} HTB`;
