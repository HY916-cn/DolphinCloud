import { DIVISIONS, Icon, Notice, Page, Podium, RankNext, RankRow, RankSummary, TxnListLoading, useRanking } from '@/components';
import { formatAmount } from '@/lib/format';
import { useMe } from '@/lib/session';

const enter = (i: number, className = '') => ({ className: `dc-stack dc-enter ${className}`, style: { '--i': i } as React.CSSProperties });

// 排名: the first three on the podium and the rest of the top with each balance against the first place's; my place
// as a large medal, what passes the place above, my place on a bar from the last place to the first, and the students
// right before and after me when I am below the top.
export default function StudentRanking() {
  const student = useMe().data!.student!;
  const ranking = useRanking(student.student_no);
  const r = ranking.data;
  const division = DIVISIONS[student.division];
  const bar = (balance: number) => (r?.top[0]?.balance ? balance / r.top[0].balance : 0);

  return (
    <Page title="存款排名" sub={division}>
      {ranking.error ? (
        <Notice tone="danger" title="暂时无法读取排名">请检查网络后刷新页面。</Notice>
      ) : (
        <div className="dc-split">
          <section {...enter(1)}>
            {!r ? <TxnListLoading label="正在加载排名" /> : r.top.length ? <>
              <div className="dc-section-head"><h2 className="heading">{division}存款榜</h2></div>
              <Podium rows={r.top} />
              {r.top.length > 3 && <ol className="dc-ranks">{r.top.slice(3).map((row, i) => <RankRow key={i} row={row} bar={bar(row.balance)} />)}</ol>}
            </> : (
              <div className="dc-card">
                <div className="dc-empty">
                  <span className="dc-empty-icon dc-kind-reward"><Icon name="ranking" /></span>
                  <h3>本学部还没有排名</h3>
                  <p>同学们在柜台存款后，这里会按存款排出名次。</p>
                </div>
              </div>
            )}
          </section>
          <div {...enter(0, 'is-sticky')}>
            {!r ? <span className="dc-skeleton" style={{ height: 280, borderRadius: 'var(--radius-lg)' }} /> : r.me ? (
              <section className="dc-card dc-rank-card">
                <div className="dc-rank-head"><h2 className="heading"><Icon name="ranking" />我的名次</h2></div>
                <RankSummary r={r} note={`存款 ${formatAmount(r.me.balance)} HTB`} />
                <RankNext r={r} />
                <div className="dc-rank-scale">
                  <div className="dc-rank-track" role="img" aria-label={`在${division} ${r.total} 人中排第 ${r.me.rank} 名`}
                    style={{ '--value': (r.total > 1 ? r.me.behind / (r.total - 1) : 1).toFixed(3) } as React.CSSProperties}><i /><b /></div>
                  <div className="dc-rank-ends"><span>第 {r.total} 名</span><span>第 1 名</span></div>
                </div>
                <p style={{ margin: 0, font: '600 16px/24px var(--font-sans)' }}>超过了{division} {r.me.behind} 位同学</p>
              </section>
            ) : (
              <Notice title="账户暂不参加排名" />
            )}
            {r?.me && !r.top.some((t) => t.me) && <>
              <div className="dc-section-head"><h2 className="heading">我的前后</h2></div>
              <ol className="dc-ranks">{r.me.near.map((row, i) => <RankRow key={i} row={row} bar={bar(row.balance)} />)}</ol>
            </>}
          </div>
        </div>
      )}
    </Page>
  );
}
