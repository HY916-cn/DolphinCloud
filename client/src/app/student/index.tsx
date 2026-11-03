import { useQuery } from '@tanstack/react-query';
import { DIVISIONS, Icon, link, medal, Notice, Page, Passbook, PassbookPage, PassbookRows, PassbookSeal, rankNext, signed, TxnListLoading, useRanking, useTerm } from '@/components';
import { formatAmount } from '@/lib/format';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { toTxn, type TxnRow } from '@/lib/txns';

function greeting(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hourCycle: 'h23' }).format(now));
  return h < 12 ? '上午好' : h < 18 ? '下午好' : '晚上好';
}

// 学生首页: the student's 存折 laid open. The first page holds the account, the balance under the bank's seal and this
// term's money in and out; the second prints the nine latest businesses, cash exchanges included, with the balance
// after each. Below it, the place in the division links to 排名.
export default function StudentHome() {
  const student = useMe().data!.student!;
  const term = useTerm(student.student_no);
  const ranking = useRanking(student.student_no);
  const txns = useQuery({
    queryKey: ['student-home', student.student_no],
    queryFn: async () => {
      const { data, error } = await supabase.from('txns').select('id,type,amount,balance_delta,balance_after,payment,status,reason,created_at,txn_items(name,qty)')
        .eq('student_no', student.student_no).order('seq', { ascending: false }).limit(9);
      if (error) throw error;
      return (data as TxnRow[]).map(toTxn);
    },
  });
  const r = ranking.data;

  return (
    <Page title={`${greeting()}，${student.name}`} sub="这是你的海豚云存折">
      {term.error || txns.error ? (
        <Notice tone="danger" title="暂时无法读取账户">请检查网络后刷新页面。</Notice>
      ) : (
        <div className="dc-stack">
          <div className="dc-enter">
            <Passbook spread>
              <PassbookPage title="储蓄存折" side={<small>{DIVISIONS[student.division]}</small>}>
                <dl className="dc-pb-fields">
                  <dt>户名</dt><dd>{student.name}</dd>
                  <dt>账号</dt><dd>{student.student_no}</dd>
                  <dt>班级</dt><dd>{student.class_label ?? `${student.class_no} 班`}</dd>
                </dl>
                <div className="dc-pb-balance">
                  <dl><dt>当前余额</dt><dd>{term.data ? formatAmount(term.data.balance) : '…'}<small>HTB</small></dd></dl>
                  <PassbookSeal />
                </div>
                {term.data && (
                  <dl className="dc-pb-fields dc-pb-sums">
                    <dt>本学期存入</dt><dd className="is-in">{signed(term.data.saved)}</dd>
                    <dt>本学期支出</dt><dd>{signed(term.data.spent)}</dd>
                  </dl>
                )}
              </PassbookPage>
              <PassbookPage title="交易记录" side={<a {...link('/student/txns')}>翻看全部</a>} foot="第 1 页">
                {!txns.data ? <TxnListLoading /> : txns.data.length ? <PassbookRows items={txns.data} lines={9} /> : (
                  <p className="dc-pb-empty"><b>还没有交易记录</b>在柜台办理存款后，这里会打印每一笔交易。</p>
                )}
              </PassbookPage>
            </Passbook>
          </div>
          {r?.me && (
            <a className="dc-card dc-rank-link dc-enter" style={{ '--i': 1 } as React.CSSProperties} {...link('/student/ranking')}
              aria-label={`存款排名第 ${r.me.rank} 名，查看排名`}>
              <span className={medal(r.me.rank)}>{r.me.rank}</span>
              <span><b>存款排名第 {r.me.rank} 名</b><small>{rankNext(r)}</small></span>
              <Icon name="next" />
            </a>
          )}
        </div>
      )}
    </Page>
  );
}
