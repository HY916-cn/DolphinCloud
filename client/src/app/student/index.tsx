import {
  BalanceCard, CreditFailed, CreditGauge, CreditGaugeLoading, DIVISIONS, Icon, link, Notice, Page, RankNext, RankRow, TxnList, TxnListLoading, useCredit, useGaugeCurve, useInterest,
  useMyLoans, useMyWealth, useRanking, useTerm,
} from '@/components';
import { heldValue } from '@/lib/wealth';
import { formatAmount, formatCenti, greeting } from '@/lib/format';
import { useRecent } from '@/lib/ledger';
import { homeLoanLine, openLoan } from '@/lib/loans';
import { useNewRows } from '@/lib/motion';
import { pendingNote } from '@/lib/rates';
import { useMe } from '@/lib/session';

const enter = (i: number) => ({ className: 'dc-stack dc-enter', style: { '--i': i } as React.CSSProperties });

// 学生首页: the balance with this term's money in and out, the 海豚信用分 under it (a link to 信用), the place in the
// division with the students right before and after, and the nine latest businesses of the account, cash exchanges
// included.
export default function StudentHome() {
  const student = useMe().data!.student!;
  const term = useTerm(student.student_no);
  const ranking = useRanking(student.student_no);
  const txns = useRecent(student.student_no);
  const credit = useCredit();
  const interest = useInterest();
  const loans = useMyLoans(student.student_no);
  const wealth = useMyWealth(student.student_no);
  const held = wealth.data && heldValue(wealth.data);
  const curve = useGaugeCurve();
  const c = credit.data;
  const fresh = useNewRows(txns.data?.map((t) => t.key));
  const r = ranking.data;
  const loan = loans.data && homeLoanLine(openLoan(loans.data));

  return (
    <Page title={`${greeting()}，${student.name}`} sub={`${student.class_label ?? `${student.class_no} 班`} · 学号 ${student.student_no}`}>
      {term.error || txns.error ? (
        <Notice tone="danger" title="暂时无法读取账户">请检查网络后刷新页面。</Notice>
      ) : (
        <div className="dc-split">
          <div className="dc-stack">
            <div {...enter(0)}>
              {term.data ? <BalanceCard amount={term.data.balance} term={term.data} />
                : <span className="dc-skeleton" style={{ height: 240, borderRadius: 'var(--radius-lg)' }} />}
            </div>
            {/* 信用摘要: 攒着的利息, 定期合计, 理财 and 贷款 beside the gauge. */}
            <section className="dc-card dc-credit-summary dc-enter" style={{ '--i': 1 } as React.CSSProperties}>
              {credit.isError ? <CreditFailed title="暂时无法读取信用分" onRetry={() => credit.refetch()} />
                : !c || interest.isPending || loans.isPending || !term.data ? <CreditGaugeLoading size="md" /> : <>
                  <dl className="dc-kv">
                    {/* The whole row opens 利息 (StudentInterestPage), when it cannot be read too. */}
                    <div className="is-link">
                      <dt><a {...link('/student/interest')} aria-label={interest.data
                        ? `攒着的利息 ${formatCenti(interest.data.pending_centi)} HTB，查看利息` : '攒着的利息，查看利息'}>攒着的利息</a></dt>
                      <dd>{interest.data ? <>{formatCenti(interest.data.pending_centi)} HTB
                        <small>{pendingNote(interest.data.pending_centi, !interest.data.savings_enabled)}</small></> : '—'}<Icon name="next" /></dd>
                    </div>
                    <div><dt>定期合计</dt><dd>{term.data.term_total ? `${formatAmount(term.data.term_total)} HTB` : '没有'}</dd></div>
                    <div><dt>理财</dt><dd>{wealth.isError ? '—' : !wealth.data ? '…' : held
                      ? <>{held.text}<small><span className={`dc-pl ${held.gain.cls}`}>{held.gain.text}</span></small></> : '没有'}</dd></div>
                    <div className={loan?.danger ? 'is-danger' : undefined}>
                      <dt>贷款</dt>
                      <dd>{!loan ? '—' : <>{loan.danger && <Icon name="warning" />}{loan.text}{loan.note && <small>{loan.note}</small>}</>}</dd>
                    </div>
                  </dl>
                  <a className="dc-credit-summary-gauge" aria-label={`海豚信用分 ${c.score} 分，查看信用`} {...link('/student/credit')}>
                    <CreditGauge score={c.score} size="md" limit={c.loan_limit} {...curve} />
                  </a>
                </>}
            </section>
            {ranking.error ? <Notice tone="danger" title="暂时无法读取排名">请检查网络后刷新页面。</Notice>
              : !r ? <span className="dc-skeleton" style={{ height: 240, borderRadius: 'var(--radius-lg)' }} /> : r.me && (
                <section className="dc-card dc-rank-card dc-enter" style={{ '--i': 2 } as React.CSSProperties}>
                  <div className="dc-rank-head">
                    <h2 className="heading"><Icon name="ranking" />存款排名</h2>
                    <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link('/student/ranking')}>查看排名</a>
                  </div>
                  <p className="dc-rank-place">第 {r.me.rank} 名<small>{DIVISIONS[r.division]} {r.total} 人</small></p>
                  <RankNext r={r} />
                  <ol className="dc-ranks" style={{ padding: 0, border: 0 }}>
                    {r.me.near.map((row, i) => <RankRow key={i} row={row} />)}
                  </ol>
                </section>
              )}
          </div>
          <section {...enter(3)}>
            <div className="dc-section-head">
              <h2 className="heading">最近交易</h2>
              <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link('/student/txns')}>查看全部</a>
            </div>
            {!txns.data ? <TxnListLoading /> : txns.data.length ? <TxnList items={txns.data} fresh={fresh} /> : (
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
