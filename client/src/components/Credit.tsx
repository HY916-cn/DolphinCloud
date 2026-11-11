import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { CreditProfile, Curve } from '@/lib/credit';
import { formatSigned, formatTime } from '@/lib/format';
import { useRolling } from '@/lib/motion';
import { call } from '@/lib/rpc';
import { supabase } from '@/lib/supabase';
import { Icon, Notice } from './ui';

// CreditGauge (design system): the only way a 海豚信用分 shows. The progress runs from 0 to the score on a track of 0 to
// 1000, red below `min` (is-low, the curve's lowest score to borrow) and green from it; the knob turns to the score
// through the registered --score property, and the number rolls from the old score to a new one (not on first show).
// `limit` (loan_limit, null: no loan) shows on lg and md, `next` (points_to_next, the limit then grows by `step`) on lg;
// sm is the arc and the number.
export function CreditGauge({ score, size, limit, next, min = 400, step = 5 }: {
  score: number; size: 'lg' | 'md' | 'sm'; limit?: number | null; next?: number | null; min?: number; step?: number;
}) {
  const s = Math.min(1000, Math.max(0, score));
  const shown = useRolling(s);
  const meter = {
    className: `dc-gauge-dial ${s < min ? 'is-low' : ''}`,
    role: 'meter', 'aria-label': '海豚信用分', 'aria-valuemin': 0, 'aria-valuemax': 1000, 'aria-valuenow': s,
    'aria-valuetext': `海豚信用分 ${s} 分`, style: { '--score': s, '--min': min } as React.CSSProperties,
  };
  if (size === 'sm') {
    return (
      <span className="dc-gauge is-sm">
        <span {...meter}><span className="dc-gauge-arc" /><span className="dc-gauge-pointer" /></span>
        <b className="dc-gauge-score" aria-hidden="true">{shown}</b>
      </span>
    );
  }
  return (
    <div className={`dc-gauge is-${size}`}>
      <div {...meter}>
        <span className="dc-gauge-arc" />
        <span className="dc-gauge-tick" />
        <span className="dc-gauge-mark">可贷款</span>
        <span className="dc-gauge-pointer" />
        <b className="dc-gauge-score">{shown}<small>分</small></b>
      </div>
      <p className="dc-gauge-ends" aria-hidden="true"><span>0</span><span>1000</span></p>
      {limit !== undefined && <p className="dc-gauge-foot">{limit === null ? `${min} 分以上才能贷款` : <>贷款额度 <b>{limit} HTB</b></>}</p>}
      {size === 'lg' && next != null && <p className="dc-gauge-next">再涨 {next} 分，额度加 {step} HTB</p>}
    </div>
  );
}

// What a gauge takes from credit_curve: the lowest score to borrow and the limit's step. Every login reads settings;
// until it is read, or when it cannot be, the defaults stand.
export function useGaugeCurve() {
  const curve = useQuery({
    queryKey: ['settings', 'credit_curve'],
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('value').eq('key', 'credit_curve').maybeSingle();
      if (error) throw error;
      return (data?.value ?? null) as Curve | null;
    },
  });
  return curve.data ? { min: curve.data.min_score, step: curve.data.limit_step } : {};
}

// A student's score with what it gives: their own with no student number, any student's for the back office.
export function useCredit(studentNo?: string) {
  return useQuery({
    queryKey: ['credit', studentNo ?? 'me'],
    queryFn: () => call<CreditProfile>('credit_profile', studentNo ? { p_student_no: studentNo } : {}),
  });
}

// Every change of a student's score, newest first, `page` at a time.
export type CreditEvent = { id: number; at: string; delta: number; score: number; reason: string };
export function useCreditEvents(studentNo: string, page: number) {
  return useInfiniteQuery({
    queryKey: ['credit-events', studentNo, page],
    initialPageParam: 0,
    getNextPageParam: (last: CreditEvent[], pages) => (last.length === page ? pages.length : undefined),
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.from('credit_events').select('id,at,delta,score,reason').eq('student_no', studentNo)
        .order('at', { ascending: false }).order('id', { ascending: false }).range(pageParam * page, pageParam * page + page - 1);
      if (error) throw error;
      return data as CreditEvent[];
    },
  });
}

// 信用分变动 as TxnList draws it: the reason, the time and the score after it, and +5 加分 or −50 减分.
export function CreditEvents({ items, fresh }: { items: CreditEvent[]; fresh: ReadonlySet<string> }) {
  return (
    <ul className="dc-txns dc-stagger">
      {items.map((e) => (
        <li key={e.id} className={`dc-txn ${fresh.has(String(e.id)) ? 'is-new' : ''}`}>
          <span className="dc-txn-icon"><Icon name="gauge" /></span>
          <div className="dc-txn-main">
            <div className="dc-txn-title">{e.reason}</div>
            <div className="dc-txn-time">{formatTime(e.at)} · 变动后 {e.score} 分</div>
          </div>
          <div className={`dc-txn-amount ${e.delta > 0 ? 'is-in' : ''}`}>{formatSigned(e.delta)}<small>{e.delta > 0 ? '加分' : '减分'}</small></div>
        </li>
      ))}
    </ul>
  );
}

// While the score loads: a block the size of the gauge with its lines.
export function CreditGaugeLoading({ size }: { size: 'lg' | 'md' }) {
  return <span className="dc-skeleton" role="status" aria-label="正在读取信用分"
    style={{ display: 'block', width: size === 'lg' ? 306 : 222, maxWidth: '100%', height: size === 'lg' ? 236 : 172, margin: '0 auto' }} />;
}

// A part of a credit page that could not be read: what, and 重试. Never a gauge at 0.
export function CreditFailed({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <Notice tone="danger" title={title}>
      请检查网络后重试。
      <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={onRetry}>重试</button>
    </Notice>
  );
}
