import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { Filter } from '@/components/Filter';
import { readAll, supabase } from './supabase';
import { toTxn, type TxnRow } from './txns';

// A student's own ledger, read the same way by the 学生 pages and the 存折: the latest businesses, every business by
// type and filter, and this month's money in and out.
const COLUMNS = 'id,type,amount,balance_delta,balance_after,payment,status,reason,created_at,txn_items(name,qty)';
const PAGE = 30;

export const TXN_TABS = {
  all: { label: '全部', empty: '还没有交易记录', hint: '在柜台办理存款后，这里会显示每一笔交易。' },
  deposit: { label: '存款', empty: '还没有存款记录', hint: '在柜台存款后，这里会显示每一笔存款。' },
  withdraw: { label: '取款', empty: '还没有取款记录', hint: '在柜台取款后，这里会显示每一笔取款。' },
  purchase: { label: '兑换', empty: '还没有兑换记录', hint: '在柜台兑换商品后，这里会显示每一笔兑换。' },
  salary: { label: '工资', empty: '还没有工资记录', hint: '担任柜员并参与考勤后，工资每周发到这里。' },
} as const;
export type TxnTab = keyof typeof TXN_TABS;

// The nine latest businesses, cash exchanges included.
export function useRecent(studentNo: string) {
  return useQuery({
    queryKey: ['student-home', studentNo],
    queryFn: async () => {
      const { data, error } = await supabase.from('txns').select(COLUMNS).eq('student_no', studentNo).order('seq', { ascending: false }).limit(9);
      if (error) throw error;
      return (data as TxnRow[]).map(toTxn);
    },
  });
}

// Every business newest first, 30 at a time, by type (`tab`), by words of a 交易号 or a product and by days.
export function useLedger(studentNo: string, tab: TxnTab, filter: Filter, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['student-txns', studentNo, tab, filter],
    enabled,
    initialPageParam: 0,
    getNextPageParam: (last: TxnRow[], pages) => (last.length === PAGE ? pages.length : undefined),
    queryFn: async ({ pageParam }) => {
      let q = supabase.from('txns').select(COLUMNS).eq('student_no', studentNo);
      if (tab !== 'all') q = q.eq('type', tab);
      if (filter.from) q = q.gte('created_at', `${filter.from}T00:00:00+08:00`);
      if (filter.to) q = q.lte('created_at', `${filter.to}T23:59:59.999+08:00`);
      if (filter.timeFrom) q = q.gte('cn_time', filter.timeFrom);
      if (filter.timeTo) q = q.lt('cn_time', filter.timeTo);
      const words = filter.text.trim().replace(/[%_\\,()*]/g, '');
      if (words) {
        // A product's name is in txn_items; the transactions holding it join the ones whose 交易号 matches.
        // Only this student's items, so the cap holds every match but a student's 500th purchase of the same product.
        const { data, error } = await supabase.from('txn_items').select('txn_id,txns!inner(student_no)')
          .eq('txns.student_no', studentNo).ilike('name', `%${words}%`).limit(500);
        if (error) throw error;
        q = q.or([`txn_no.ilike.*${words}*`, ...(data.length ? [`id.in.(${data.map((i) => i.txn_id).join(',')})`] : [])].join(','));
      }
      const { data, error } = await q.order('seq', { ascending: false }).range(pageParam * PAGE, pageParam * PAGE + PAGE - 1);
      if (error) throw error;
      return data as TxnRow[];
    },
  });
}

// This month as the school reads it (Asia/Shanghai): every change to the balance since it began, 冲正 included, so last
// month's closing balance, what came in and what went out add up to the balance now. `m` is the month's number.
export function useMonth(studentNo: string) {
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date());
  const totals = useQuery({
    queryKey: ['student-month', studentNo, month],
    queryFn: async () => {
      const [account, data] = await Promise.all([
        supabase.from('accounts').select('balance').eq('student_no', studentNo).single(),
        readAll<{ balance_delta: number }>((from, to) => supabase.from('txns').select('balance_delta')
          .eq('student_no', studentNo).gte('created_at', `${month}-01T00:00:00+08:00`).order('seq').range(from, to)),
      ]);
      if (account.error) throw account.error;
      const saved = data.reduce((n, t) => n + Math.max(t.balance_delta, 0), 0);
      const spent = data.reduce((n, t) => n + Math.min(t.balance_delta, 0), 0);
      return { balance: account.data.balance, saved, spent, opening: account.data.balance - saved - spent };
    },
  });
  return { m: Number(month.slice(5)), totals };
}
