import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { formatAmount, formatNet } from '@/lib/format';
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
// The balance is 存款 net of unpaid loans and may be negative; its bar is then drawn at 0.
export function RankRow({ row, bar }: { row: Row; bar?: number }) {
  return (
    <li className={`dc-rank ${row.rank <= 3 ? 'is-top' : ''} ${row.rank === 1 ? 'is-first' : ''} ${row.me ? 'is-me' : ''}`}
      aria-current={row.me || undefined}>
      <span className="dc-rank-no" aria-label={`第 ${row.rank} 名`}>{row.rank}</span>
      <div className="dc-rank-who">
        <div className="dc-rank-name">{row.name}{row.me && <span className="dc-tag dc-tag-coin"><Icon name="me" />我</span>}</div>
        <div className="dc-rank-class">{row.class_label ?? `${row.cohort} 届`}</div>
      </div>
      <div className="dc-rank-amount">{formatNet(row.balance)}<small>HTB</small></div>
      {bar !== undefined && <span className="dc-rank-bar" aria-hidden="true"><i style={{ '--value': Math.max(0, bar).toFixed(3) } as React.CSSProperties} /></span>}
    </li>
  );
}

// A place's medal: gold, silver and bronze for the first three, plain beyond.
export const medal = (rank: number) => `dc-medal ${['', 'is-gold', 'is-silver', 'is-bronze'][rank] ?? ''}`;

// The first three on the podium (design system Podium), drawn 2–1–3 from left to right.
export function Podium({ rows }: { rows: Row[] }) {
  return (
    <ol className="dc-podium" aria-label="前三名">
      {rows.slice(0, 3).map((row, i) => (
        <li key={i} className={row.me ? 'is-me' : undefined} aria-current={row.me || undefined}>
          <span className={medal(row.rank)} aria-label={`第 ${row.rank} 名`}>{row.rank}</span>
          <div className="dc-rank-name">{row.name}{row.me && <span className="dc-tag dc-tag-coin"><Icon name="me" />我</span>}</div>
          <div className="dc-rank-class">{row.class_label ?? `${row.cohort} 届`}</div>
          <div className="dc-podium-step">{formatNet(row.balance)}<small>HTB</small></div>
        </li>
      ))}
    </ol>
  );
}

// The student's place: a large medal beside "第 12 名" and `note` under it.
export function RankSummary({ r, note }: { r: Ranking; note: ReactNode }) {
  const me = r.me!;
  return (
    <div className="dc-rank-sum">
      <span className={`${medal(me.rank)} is-lg`} aria-hidden="true">{me.rank}</span>
      <p className="dc-rank-place">第 {me.rank} 名<small>{note}</small></p>
    </div>
  );
}

// How much more passes the place just above: one coin more than its balance.
export function rankNext(r: Ranking) {
  const me = r.me!;
  return me.above ? <span>再存 <b>{formatAmount(me.above.balance - me.balance + 1)} HTB</b> 超过第 {me.above.rank} 名</span>
    : <span>你是{DIVISIONS[r.division]}第 1 名</span>;
}

export function RankNext({ r }: { r: Ranking }) {
  return <p className="dc-rank-next"><Icon name="star" />{rankNext(r)}</p>;
}
