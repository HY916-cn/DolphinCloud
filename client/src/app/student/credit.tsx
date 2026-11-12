import {
  CreditEvents, CreditFailed, CreditGauge, CreditGaugeLoading, MyLoans, Page, RateCard, TermList, today, TxnListLoading, useCredit, useCreditEvents, useGaugeCurve,
  useMyLoans, useMyTerms,
} from '@/components';
import { useNewRows } from '@/lib/motion';
import { useMe } from '@/lib/session';

const enter = (i: number) => ({ className: 'dc-stack dc-enter', style: { '--i': i } as React.CSSProperties });

// 信用 (design system StudentCreditPage): the student's 海豚信用分 on the large gauge with what it lends, the week's rates
// at that score, 我的贷款, 我的定期, and every change of the score, newest first, 20 at a time. Each part reads and fails on
// its own.
export default function StudentCredit() {
  const student = useMe().data!.student!;
  const credit = useCredit();
  const curve = useGaugeCurve();
  const events = useCreditEvents(student.student_no, 20);
  const rows = events.data?.pages.flat();
  const fresh = useNewRows(rows?.map((e) => e.id));
  const terms = useMyTerms(student.student_no);
  const loans = useMyLoans(student.student_no);
  const c = credit.data;

  return (
    <Page title="信用" sub="海豚信用分">
      <div className="dc-split">
        <div className="dc-stack">
          <div {...enter(0)}>
            <p className="dc-list-title">信用分</p>
            {credit.isError ? <CreditFailed title="暂时无法读取信用分" onRetry={() => credit.refetch()} /> : (
              <section className="dc-card dc-stack">
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  {c ? <CreditGauge score={c.score} size="lg" limit={c.loan_limit} next={c.points_to_next} {...curve} /> : <CreditGaugeLoading size="lg" />}
                </div>
                <p className="dc-caption">每周一更新。按时还款、每周存钱、余额保持在 100 HTB 以上都会加分。</p>
              </section>
            )}
          </div>
          <div {...enter(1)}><RateCard min={curve.min ?? 400} /></div>
        </div>
        <div className="dc-stack">
          <div {...enter(2)}>
            <p className="dc-list-title">我的贷款</p>
            {loans.isError ? <CreditFailed title="暂时无法读取贷款" onRetry={() => loans.refetch()} />
              : !loans.data || !c ? <TxnListLoading rows={2} label="正在加载贷款" />
              : <MyLoans loans={loans.data} limit={c.loan_limit} min={curve.min ?? 400} />}
          </div>
          <div {...enter(3)}>
            <p className="dc-list-title">我的定期</p>
            {terms.isError ? <CreditFailed title="暂时无法读取定期" onRetry={() => terms.refetch()} />
              : !terms.data ? <TxnListLoading rows={2} label="正在加载定期" />
              : terms.data.length ? <TermList deposits={terms.data} today={today()} /> : (
                <section className="dc-card"><p className="dc-caption">没有定期。可以在柜台把活期存成定期，存期 2、4 或 8 周，利率比活期高。</p></section>
              )}
          </div>
          <div {...enter(4)}>
            <p className="dc-list-title">信用分变动</p>
            {events.isError && !rows ? <CreditFailed title="暂时无法读取变动记录" onRetry={() => events.refetch()} />
              : !rows ? <TxnListLoading label="正在加载变动记录" />
              : rows.length ? <CreditEvents items={rows} fresh={fresh} /> : (
                <section className="dc-card"><p className="dc-caption">还没有变动。每周一会按上周的存款和余额加减分。</p></section>
              )}
            {events.isFetchingNextPage && <TxnListLoading rows={2} label="正在加载变动记录" />}
            {events.isError && rows && <CreditFailed title="暂时无法读取变动记录" onRetry={() => events.fetchNextPage()} />}
            {events.hasNextPage && !events.isFetchingNextPage && (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={() => events.fetchNextPage()}>加载更多</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </Page>
  );
}
