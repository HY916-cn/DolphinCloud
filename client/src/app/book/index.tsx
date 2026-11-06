import { DIVISIONS, link, Notice, Passbook, PassbookPage, PassbookRows, PassbookSeal, signed, TxnListLoading, useRanking, useTerm } from '@/components';
import { formatAmount, greeting } from '@/lib/format';
import { useRecent } from '@/lib/ledger';
import { useMe } from '@/lib/session';

// 账户: the account's page with the balance under the bank's seal, this term's money in and out and the place in the
// division; facing it, the nine latest businesses with the balance after each.
export default function BookAccount() {
  const student = useMe().data!.student!;
  const term = useTerm(student.student_no);
  const ranking = useRanking(student.student_no);
  const txns = useRecent(student.student_no);
  const r = ranking.data;

  return (
    <Passbook spread>
      <PassbookPage title="储蓄存折" side={<small>{greeting()}，{student.name}</small>}>
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
            <dt>本学期存入</dt><dd className="is-in">{term.data ? signed(term.data.saved) : '…'}</dd>
            <dt>本学期支出</dt><dd>{term.data ? signed(term.data.spent) : '…'}</dd>
            {r?.me && <><dt>存款排名</dt><dd>第 {r.me.rank} 名<small>{DIVISIONS[r.division]} {r.total} 人</small></dd></>}
          </dl>
        </>}
        <ol className="dc-pb-rules" aria-label="存折须知">
          <li>本存折只限本人使用，密码不要告诉别人。</li>
          <li>每一笔存取和兑换都印在交易记录里，可随时到柜台核对。</li>
        </ol>
      </PassbookPage>
      <PassbookPage title="交易记录" side={<a {...link('/book/txns')}>翻看全部</a>} foot="第 1 页">
        {txns.error ? <Notice tone="danger" title="暂时无法读取交易">请检查网络后刷新页面。</Notice>
          : !txns.data ? <TxnListLoading /> : txns.data.length ? <PassbookRows items={txns.data} lines={9} /> : (
            <p className="dc-pb-empty"><b>还没有交易记录</b>在柜台办理存款后，这里会打印每一笔交易。</p>
          )}
      </PassbookPage>
    </Passbook>
  );
}
