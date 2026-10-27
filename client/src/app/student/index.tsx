import { useQuery } from '@tanstack/react-query';
import { Text } from 'react-native';
import { BalanceCard, Loading, Notice, Screen, TxnList } from '@/components';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { toTxn, type TxnRow } from '@/lib/txns';
import { color, text } from '@/theme';

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
    <Screen tabBar>
      <Text role="heading" aria-level={1} style={{ ...text.title, color: color.ink }}>你好，{student.name}</Text>
      {home.isPending ? <Loading /> : home.error ? (
        <Notice variant="danger" title="暂时无法读取账户">请检查网络后刷新页面。</Notice>
      ) : (
        <>
          <BalanceCard amount={home.data.balance} />
          <Text role="heading" aria-level={2} style={{ ...text.heading, color: color.ink }}>最近交易</Text>
          {home.data.txns.length ? <TxnList items={home.data.txns} /> : (
            <Notice title="还没有交易记录">在柜台办理存款后，这里会显示每一笔交易。</Notice>
          )}
        </>
      )}
    </Screen>
  );
}
