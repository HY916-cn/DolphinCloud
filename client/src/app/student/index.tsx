import { useQuery } from '@tanstack/react-query';
import { BalanceCard, DIVISIONS, Icon, link, Notice, Page, RankNext, RankRow, TxnList, TxnListLoading, useRanking, useTerm } from '@/components';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { toTxn, type TxnRow } from '@/lib/txns';

const enter = (i: number) => ({ className: 'dc-stack dc-enter', style: { '--i': i } as React.CSSProperties });

function greeting(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hourCycle: 'h23' }).format(now));
  return h < 12 ? '上午好' : h < 18 ? '下午好' : '晚上好';
}

// 学生首页: the balance with this term's sea, the place in the division, and the nine latest businesses of the
// account, cash exchanges included.
export default function StudentHome() {
  const student = useMe().data!.student!;
  const term = useTerm(student.student_no);
  const ranking = useRanking(student.student_no);
  const txns = useQuery({
    queryKey: ['student-home', student.student_no],
    queryFn: async () => {
      const { data, error } = await supabase.from('txns').select('id,type,amount,balance_delta,payment,status,reason,created_at,txn_items(name,qty)')
        .eq('student_no', student.student_no).order('seq', { ascending: false }).limit(9);
      if (error) throw error;
      return (data as TxnRow[]).map(toTxn);
    },
  });
  const r = ranking.data;

  return (
    <Page title={`${greeting()}，${student.name}`} sub={`${student.class_label ?? `${student.class_no} 班`} · 学号 ${student.student_no}`}>
      {term.error || txns.error ? (
        <Notice tone="danger" title="暂时无法读取账户">请检查网络后刷新页面。</Notice>
      ) : (
        <div className="dc-split">
          <div className="dc-stack">
            <div {...enter(0)}>
              {term.data ? <BalanceCard amount={term.data.balance} tide={term.data.tide} />
                : <span className="dc-skeleton" style={{ height: 300, borderRadius: 'var(--radius-lg)' }} />}
            </div>
            {!ranking.error && (!r ? <span className="dc-skeleton" style={{ height: 240, borderRadius: 'var(--radius-lg)' }} /> : r.me && (
              <section className="dc-card dc-rank-card dc-enter" style={{ '--i': 1 } as React.CSSProperties}>
                <div className="dc-rank-head">
                  <h2 className="heading"><Icon name="ranking" />存款排名</h2>
                  <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link('/student/ranking')}>查看排名</a>
                </div>
                <p className="dc-rank-place">第 {r.me.rank} 名<small>{DIVISIONS[r.division]} {r.total} 人</small></p>
                <RankNext r={r} />
                <ol className="dc-ranks" style={{ padding: 0, border: 0 }}>
                  {r.me.near.map((row) => <RankRow key={row.rank + row.name} row={row} />)}
                </ol>
              </section>
            ))}
          </div>
          <section {...enter(2)}>
            <div className="dc-section-head">
              <h2 className="heading">最近交易</h2>
              <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link('/student/txns')}>查看全部</a>
            </div>
            {!txns.data ? <TxnListLoading /> : txns.data.length ? <TxnList items={txns.data} /> : (
              <div className="dc-card">
                <div className="dc-empty">
                  <span className="dc-empty-icon"><Icon name="inbox" /></span>
                  <h3>还没有交易记录</h3>
                  <p>在柜台办理存款后，这里会显示每一笔交易。</p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </Page>
  );
}
