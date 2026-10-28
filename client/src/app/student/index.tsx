import { useQuery } from '@tanstack/react-query';
import { BalanceCard, Icon, Notice, Page, TxnList, TxnListLoading } from '@/components';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { toTxn, type TxnRow } from '@/lib/txns';

const enter = (i: number) => ({ className: 'dc-stack dc-enter', style: { '--i': i } as React.CSSProperties });

function greeting(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hourCycle: 'h23' }).format(now));
  return h < 12 ? '上午好' : h < 18 ? '下午好' : '晚上好';
}

// 学生首页: balance and the ten latest movements of the account (cash purchases do not touch it).
export default function StudentHome() {
  const student = useMe().data!.student!;
  const home = useQuery({
    queryKey: ['student-home', student.student_no],
    queryFn: async () => {
      const [account, txns] = await Promise.all([
        supabase.from('accounts').select('balance').eq('student_no', student.student_no).single(),
        supabase.from('txns').select('id,type,amount,balance_delta,payment,status,reason,created_at,txn_items(name,qty)')
          .eq('student_no', student.student_no).neq('balance_delta', 0).order('seq', { ascending: false }).limit(10),
      ]);
      if (account.error) throw account.error;
      if (txns.error) throw txns.error;
      return { balance: account.data.balance, txns: (txns.data as TxnRow[]).map(toTxn) };
    },
  });

  return (
    <Page title={`${greeting()}，${student.name}`} sub={`${student.class_label ?? `${student.class_no} 班`} · 学号 ${student.student_no}`}>
      {home.error ? (
        <Notice tone="danger" title="暂时无法读取账户">请检查网络后刷新页面。</Notice>
      ) : (
        <div className="dc-split">
          <div {...enter(0)}>
            {home.data ? <BalanceCard amount={home.data.balance} /> : <span className="dc-skeleton" style={{ height: 184, borderRadius: 'var(--radius-lg)' }} />}
          </div>
          <section {...enter(1)}>
            <div className="dc-section-head"><h2 className="heading">最近交易</h2></div>
            {!home.data ? <TxnListLoading /> : home.data.txns.length ? <TxnList items={home.data.txns} /> : (
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
