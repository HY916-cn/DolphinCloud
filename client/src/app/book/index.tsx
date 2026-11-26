import { useEffect, useState } from 'react';
import {
  BookPages, CreditGauge, DIVISIONS, link, Notice, PassbookPage, PassbookRows, PassbookSeal, signed, TxnListLoading, useCredit, useGaugeCurve, useInterest,
  useLines, useMyLoans, useMyTerms, useMyWealth, useRanking, useTerm, useWide,
} from '@/components';
import { heldValue } from '@/lib/wealth';
import { formatAmount, formatCenti, greeting } from '@/lib/format';
import { useRecent } from '@/lib/ledger';
import { homeLoanLine, openLoan } from '@/lib/loans';
import { pendingNote } from '@/lib/rates';
import { nextMaturity } from '@/lib/term-deposits';
import { useMe } from '@/lib/session';

// 账户: the account's page with the balance under the bank's seal, the 海豚信用分 on a small gauge, this term's money in
// and out and, when two pages face each other, the place in the division (a phone's page gives that line to 信用分); facing it (on a phone, the next page), the latest businesses a page holds with the balance after each, the
// ones new since this device last opened it printed as you watch; then 攒着的利息, 定期合计, 理财 and 贷款 as the 首页 writes them
// (无 where the 首页 writes 没有), each line on its own: "…" while it is read, "—" when it cannot be.
export default function BookAccount() {
  const student = useMe().data!.student!;
  const term = useTerm(student.student_no);
  const ranking = useRanking(student.student_no);
  const txns = useRecent(student.student_no);
  const credit = useCredit();
  const interest = useInterest();
  const terms = useMyTerms(student.student_no);
  const loans = useMyLoans(student.student_no);
  const open = loans.data && openLoan(loans.data);
  const loan = open && homeLoanLine(open);
  const due = terms.data && nextMaturity(terms.data);
  const wealth = useMyWealth();
  const held = wealth.data && heldValue(wealth.data);
  const curve = useGaugeCurve();
  const wide = useWide();
  const lines = useLines();
  const recent = txns.data?.slice(0, lines);
  const r = ranking.data;
  // The latest business already printed in this 存折 on this device; the ones after it are printed on opening (补登).
  const key = `dolphin.book-printed.${student.student_no}`;
  const [printed] = useState(() => { try { return localStorage.getItem(key); } catch { return null; } });
  const latest = txns.data?.[0]?.key;
  useEffect(() => { try { if (latest) localStorage.setItem(key, latest); } catch { /* nothing is kept */ } }, [key, latest]);
  const at = recent?.findIndex((t) => t.key === printed) ?? -1;
  const fresh = !recent ? 0 : at < 0 ? recent.length : at;

  return (
    <BookPages pages={[
      <PassbookPage key="account" title="储蓄存折" side={<small>{greeting()}，{student.name}</small>}>
        <dl className="dc-pb-fields">
          <dt>户名</dt><dd>{student.name}</dd>
          <dt>账号</dt><dd>{student.student_no}</dd>
          <dt>班级</dt><dd>{student.class_label ?? `${student.class_no} 班`}</dd>
          <dt>学部</dt><dd>{DIVISIONS[student.division]}</dd>
          <dt>储种</dt><dd>活期储蓄 · 海豚币（HTB）</dd>
        </dl>
        {term.error ? <Notice tone="danger" title="暂时无法读取账户">请检查网络后刷新页面。</Notice> : <>
          <div className="dc-pb-balance">
            <dl><dt>当前余额</dt><dd>{term.data ? formatAmount(term.data.balance) : '…'}<small>HTB</small></dd></dl>
            <PassbookSeal />
          </div>
          <dl className="dc-pb-fields dc-pb-sums">
            {!credit.isError && <><dt>信用分</dt><dd>{credit.data ? <CreditGauge score={credit.data.score} size="sm" {...curve} /> : '…'}</dd></>}
            <dt>本学期存入</dt><dd>{term.data ? signed(term.data.saved) : '…'}</dd>
            <dt>本学期支出</dt><dd>{term.data ? signed(term.data.spent) : '…'}</dd>
            {wide && r?.me && <><dt>存款排名</dt><dd>第 {r.me.rank} 名<small>{DIVISIONS[r.division]} {r.total} 人</small></dd></>}
          </dl>
        </>}
        <ol className="dc-pb-rules" aria-label="存折须知">
          <li>本存折只限本人使用，密码不要告诉别人。</li>
          <li>每一笔存取和兑换都印在交易记录里，可随时到柜台核对。</li>
        </ol>
      </PassbookPage>,
      <PassbookPage key="recent" title="交易记录" side={<a {...link('/book/txns')}>翻看全部</a>}>
        {txns.error ? <Notice tone="danger" title="暂时无法读取交易">请检查网络后刷新页面。</Notice>
          : !recent ? <TxnListLoading /> : recent.length ? <PassbookRows items={recent} lines={lines} fresh={fresh} /> : (
            <p className="dc-pb-empty"><b>还没有交易记录</b>在柜台办理存款后，这里会打印每一笔交易。</p>
          )}
      </PassbookPage>,
      <PassbookPage key="sums" title="利息 · 定期 · 理财 · 贷款">
        <dl className="dc-pb-fields">
          <dt>攒着的利息</dt>
          <dd>{interest.data ? <>{formatCenti(interest.data.pending_centi)} HTB<small>{pendingNote(interest.data.pending_centi, !interest.data.savings_enabled)}</small></> : interest.isError ? '—' : '…'}</dd>
          <dt>定期合计</dt>
          <dd>{!term.data ? (term.error ? '—' : '…') : term.data.term_total ? <>{formatAmount(term.data.term_total)} HTB{due && <small>{due}</small>}</> : '无'}</dd>
          <dt>理财</dt>
          <dd>{wealth.isError ? '—' : !wealth.data ? '…' : held ? <>{held.text}<small><span className={`dc-pl ${held.gain.cls}`}>{held.gain.text}</span></small></> : '无'}</dd>
          <dt>贷款</dt>
          <dd className={loan?.danger ? 'is-danger' : undefined}>{loan ? <>{loan.text}{loan.note && <small>{loan.note}</small>}</> : open === null ? '无' : loans.isError ? '—' : '…'}</dd>
        </dl>
        <ol className="dc-pb-rules" aria-label="说明">
          <li>利息每周一满 1 HTB 存进余额。</li>
          <li>定期到期当天结束时连本带息转回活期。</li>
          <li>理财有六个品种，每天随行情涨跌，可能亏损；买入第二天起可以在柜台卖出。</li>
          <li>贷款每期应还日结束时从活期自动扣。</li>
          <li>要看每笔定期、理财和还款计划，在我的栏换回普通版，再到信用页查看。</li>
        </ol>
      </PassbookPage>,
    ]} />
  );
}
