import { useQuery } from '@tanstack/react-query';
import { Icon, Notice, Page, TxnListLoading } from '@/components';
import { formatAmount } from '@/lib/format';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const enter = (i: number) => ({ className: 'dc-stack dc-enter', style: { '--i': i } as React.CSSProperties });
const DIVISIONS = { primary: '小学部', junior: '初中部' } as const;

// deposit_ranking (PHASE-1.md §6.4): the top N of the student's division, names masked when ranking_anonymous is on.
type Ranking = {
  division: keyof typeof DIVISIONS;
  top: { rank: number; name: string; class_label: string | null; cohort: number; balance: number; me: boolean }[];
  me: { rank: number; balance: number } | null;
};

// 排名: my place in the division first, then the top of the list.
export default function StudentRanking() {
  const student = useMe().data!.student!;
  const ranking = useQuery({
    queryKey: ['student-ranking', student.student_no],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('deposit_ranking');
      if (error) throw error;
      return data as Ranking;
    },
  });
  const r = ranking.data;

  return (
    <Page title="存款排名" sub={DIVISIONS[student.division]}>
      {ranking.error ? (
        <Notice tone="danger" title="暂时无法读取排名">请检查网络后刷新页面。</Notice>
      ) : (
        <div className="dc-split">
          <div {...enter(0)}>
            {!r ? <span className="dc-skeleton" style={{ height: 184, borderRadius: 'var(--radius-lg)' }} /> : r.me ? (
              <div className="dc-balance">
                <div className="dc-balance-label"><Icon name="ranking" />我的名次</div>
                <div className="dc-balance-amount">第 {r.me.rank} 名</div>
                <div className="dc-balance-split"><span>余额 <b>{formatAmount(r.me.balance)} HTB</b></span></div>
                <div className="dc-waves" aria-hidden="true"><i /><i /><i /></div>
              </div>
            ) : (
              <Notice title="账户暂不参加排名">账户状态正常后，会按余额参加本学部排名。</Notice>
            )}
          </div>
          <section {...enter(1)}>
            <div className="dc-section-head"><h2 className="heading">{r?.top.length ? `前 ${r.top.length} 名` : '排行榜'}</h2></div>
            {!r ? <TxnListLoading label="正在加载排名" /> : r.top.length ? (
              <ul className="dc-txns dc-stagger">
                {r.top.map((t, i) => (
                  <li key={i} className="dc-txn dc-kind-reward">
                    <span className="dc-txn-icon">{t.rank}</span>
                    <div className="dc-txn-main">
                      <div className="dc-txn-title">{t.name}{t.me && <> <span className="dc-tag"><Icon name="me" />我</span></>}</div>
                      <div className="dc-txn-time">{t.class_label ?? `${t.cohort} 届`}</div>
                    </div>
                    <div className="dc-txn-amount">{formatAmount(t.balance)}<small>HTB</small></div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="dc-card">
                <div className="dc-empty">
                  <span className="dc-empty-icon dc-kind-reward"><Icon name="ranking" /></span>
                  <h3>本学部还没有排名</h3>
                  <p>同学们在柜台存款后，这里会按余额排出名次。</p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </Page>
  );
}
