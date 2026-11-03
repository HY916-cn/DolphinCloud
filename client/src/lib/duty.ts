import { useQuery } from '@tanstack/react-query';
import { renderDoc } from './doc';
import { formatAmount, formatTime } from './format';
import { supabase } from './supabase';
import { KINDS } from './txns';

// 上班 / 下班 (PHASE-1.md §6.9): a teller serves at the counter only while on duty.
export type Duty = { id: string; user_id: string; started_at: string; ended_at: string | null; txns: number | null };

// The open duty, or null. The last answer is kept on the device, so the counter reloaded offline still knows.
const key = (uid: string) => `dolphin.duty:${uid}`;
export function useDuty(uid: string) {
  return useQuery({
    queryKey: ['duty', uid],
    initialData: () => {
      try {
        const saved = localStorage.getItem(key(uid));
        return saved === null ? undefined : (JSON.parse(saved) as Duty | null);
      } catch {
        return undefined;
      }
    },
    initialDataUpdatedAt: 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('duty').select('id,user_id,started_at,ended_at,txns')
        .eq('user_id', uid).is('ended_at', null).maybeSingle();
      if (error) throw error;
      try {
        localStorage.setItem(key(uid), JSON.stringify(data));
      } catch {
        // Private mode: an offline reload asks again.
      }
      return data as Duty | null;
    },
  });
}

// The duties that began in a week, newest first.
export function useDuties(uid: string, from: string, to: string) {
  return useQuery({
    queryKey: ['duty', uid, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.from('duty').select('id,user_id,started_at,ended_at,txns').eq('user_id', uid)
        .gte('started_at', `${from}T00:00:00+08:00`).lt('started_at', `${to}T24:00:00+08:00`).order('started_at', { ascending: false });
      if (error) throw error;
      return data as Duty[];
    },
  });
}

type Row = {
  txn_no: string; type: keyof typeof KINDS; amount: number; balance_delta: number; payment: 'account' | 'cash' | null;
  status: 'normal' | 'reversed'; created_at: string; student_no: string; name: string | null;
};

// Every transaction the teller made since 上班, by time: read by the server (duty_txns), as end_duty counts them, since
// a teller reads only today's 流水 and a duty may run past midnight.
async function dutyTxns() {
  const { data, error } = await supabase.rpc('duty_txns');
  if (error) throw error;
  return data as Row[];
}

// How many transactions the teller made since 上班: what end_duty checks when 下班 skips the summary.
export async function dutyCount() {
  return (await dutyTxns()).length;
}

// 下班总结: every transaction the teller made since 上班, by time, with the totals and lines to sign. Answers the
// pages and how many transactions they list (end_duty checks the number).
export async function dutySummary(duty: Duty, teller: string) {
  const rows = await dutyTxns();
  const live = rows.filter((r) => r.status === 'normal');
  const sum = (type: string) => live.filter((r) => r.type === type).reduce((s, r) => s + r.amount, 0);
  const count = (type: string) => rows.filter((r) => r.type === type).length;
  const now = new Date().toISOString();
  const pages = await renderDoc('柜员下班总结', `${teller} · 打印于 ${formatTime(now, new Date(0))}`, [
    { kind: 'heading', text: `${teller} · ${formatTime(duty.started_at, new Date(0))} 上班 至 ${formatTime(now, new Date(0))} 下班`,
      sub: '本次上班期间本人办理的全部业务，按办理时间排列；已冲正的业务不计入合计。' },
    { kind: 'stats', items: [
      ['业务笔数', `${rows.length} 笔`], ['存款', `${formatAmount(sum('deposit'))} HTB · ${count('deposit')} 笔`],
      ['取款', `${formatAmount(sum('withdraw'))} HTB · ${count('withdraw')} 笔`], ['兑换', `${formatAmount(sum('purchase'))} HTB · ${count('purchase')} 笔`],
    ] },
    { kind: 'table', head: ['时间', '交易号', '学生', '学号', '业务', '金额', '状态'],
      rows: rows.map((r) => [formatTime(r.created_at).split(' ')[1], r.txn_no, r.name ?? '',
        r.student_no, KINDS[r.type].title + (r.type === 'purchase' ? (r.payment === 'cash' ? '（现金）' : '（账户）') : ''), r.amount,
        r.status === 'reversed' ? '已冲正' : '正常']) },
    { kind: 'text', text: '核对无误后签字，交银行管理员留存。' },
    { kind: 'sign', labels: ['柜员签字', '复核人签字', '日期'] },
  ]);
  return { pages, count: rows.length };
}
