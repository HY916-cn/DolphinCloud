import { useQuery } from '@tanstack/react-query';
import { formatAmount } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Icon } from './ui';

export const DIVISIONS = { primary: '小学部', junior: '初中部' } as const;

type Row = { rank: number; name: string; class_label: string | null; cohort: number; balance: number; me: boolean };
// deposit_ranking (PHASE-1.md §6.4): the top N of the student's division, names masked when `anonymous`; and the
// caller's place, the place just above, how many have less, and the caller with the students right before and after.
export type Ranking = {
  division: keyof typeof DIVISIONS; total: number; anonymous: boolean; top: Row[];
  me: { rank: number; balance: number; above: { rank: number; balance: number } | null; behind: number; near: Row[] } | null;
};

export function useRanking(studentNo: string) {
  return useQuery({
    queryKey: ['student-ranking', studentNo],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('deposit_ranking');
      if (error) throw error;
      return data as Ranking;
    },
  });
}

// One place: gold for the top three, the dolphin ring for the student; `bar` is the balance against the first place's.
export function RankRow({ row, bar }: { row: Row; bar?: number }) {
  return (
    <li className={`dc-rank ${row.rank <= 3 ? 'is-top' : ''} ${row.rank === 1 ? 'is-first' : ''} ${row.me ? 'is-me' : ''}`}
      aria-current={row.me || undefined}>
      <span className="dc-rank-no" aria-label={`第 ${row.rank} 名`}>{row.rank}</span>
      <div className="dc-rank-who">
        <div className="dc-rank-name">{row.name}{row.me && <span className="dc-tag dc-tag-coin"><Icon name="me" />我</span>}</div>
        <div className="dc-rank-class">{row.class_label ?? `${row.cohort} 届`}</div>
      </div>
      <div className="dc-rank-amount">{formatAmount(row.balance)}<small>HTB</small></div>
      {bar !== undefined && <span className="dc-rank-bar" aria-hidden="true"><i style={{ '--value': bar.toFixed(3) } as React.CSSProperties} /></span>}
    </li>
  );
}

// How much more passes the place just above: one coin more than its balance.
export function RankNext({ r }: { r: Ranking }) {
  const me = r.me!;
  return (
    <p className="dc-rank-next"><Icon name="star" />
      {me.above ? <span>再存 <b>{formatAmount(me.above.balance - me.balance + 1)} HTB</b> 超过第 {me.above.rank} 名</span>
        : <span>你是{DIVISIONS[r.division]}第 1 名</span>}
    </p>
  );
}
