import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ConfirmSheet, Desk, Icon, KvLoading, Notice, PersonLoading, SkeletonGroup, Summary, TxnList, TxnListLoading } from '@/components';
import { classOf } from '@/lib/counter';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatTime } from '@/lib/format';
import { call } from '@/lib/rpc';
import { useMe } from '@/lib/session';
import { DIVISION, STATUS, useStudent } from '@/lib/students';
import { supabase } from '@/lib/supabase';
import { toTxn, type TxnRow } from '@/lib/txns';

// One student: who they are, whether they have signed in, the latest movements (teacher), and 重置密码.
export default function Student() {
  const { no } = useLocalSearchParams<{ no: string }>();
  const me = useMe().data!;
  const teacher = me.roles.includes('teacher');
  const queryClient = useQueryClient();
  const student = useStudent(no);
  const txns = useQuery({
    queryKey: ['admin-student-txns', no],
    enabled: teacher,
    queryFn: async () => {
      const { data, error } = await supabase.from('txns').select('id,type,amount,balance_delta,payment,status,reason,created_at,txn_items(name,qty)')
        .eq('student_no', no).neq('balance_delta', 0).order('seq', { ascending: false }).limit(10);
      if (error) throw error;
      return (data as TxnRow[]).map(toTxn);
    },
  });
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; title: string; text: string } | null>(null);
  const s = student.data;

  async function reset() {
    setConfirm(false);
    try {
      await call('reset_password', { p_user_id: s!.user_id });
      setResult({ tone: 'success', title: '密码已重置', text: `${s!.name} 的密码已恢复为 a12345678，下次登录时需要设置新密码。` });
      queryClient.invalidateQueries({ queryKey: ['admin-students'] });
    } catch (err) {
      setResult({ tone: 'danger', ...explain(err instanceof AppError ? err.code : '', err instanceof AppError ? err.detail : {}) });
    }
  }

  return (
    <Desk title="学生" back={() => router.navigate('/admin/students')}>
      {student.isError && <Notice tone="danger" title="暂时无法读取学生信息">请检查网络后刷新页面。</Notice>}
      {student.isPending && <SkeletonGroup className="dc-stack"><PersonLoading side /><KvLoading rows={4} /></SkeletonGroup>}
      {student.data === null && <Notice tone="danger" title="未找到该学号">请返回学生列表重新查找。</Notice>}
      {s && (
        <div className="dc-split">
          <div className="dc-stack dc-enter">
            <div className="dc-person">
              <span className="dc-person-avatar"><Icon name="me" /></span>
              <div className="dc-person-main">
                <div className="dc-person-name">{s.name}</div>
                <div className="dc-person-meta"><span>{classOf(s)}</span> · <span>{s.cohort} 届</span> · <span>学号 {s.student_no}</span></div>
              </div>
              {s.accounts && <div className="dc-person-side">{formatAmount(s.accounts.balance)}<small>当前余额 HTB</small></div>}
            </div>
            {result && <Notice tone={result.tone} title={result.title}>{result.text}</Notice>}
            <div className="dc-card">
              <Summary rows={[
                ['学部', DIVISION[s.division]],
                ['账户状态', STATUS[s.status]],
                ['登录', s.profiles?.disabled ? '已停用' : s.profiles?.must_change_password ? '还未设置新密码' : '已设置新密码'],
                ['开户时间', formatTime(s.opened_at)],
              ]} />
            </div>
            <button className="dc-btn dc-btn-secondary" type="button" onClick={() => { setResult(null); setConfirm(true); }}>重置密码</button>
          </div>
          {teacher && (
            <section className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties}>
              <div className="dc-section-head"><h2 className="heading">最近交易</h2></div>
              {!txns.data ? <TxnListLoading /> : txns.data.length ? <TxnList items={txns.data} /> : <p className="dc-top-sub">还没有交易记录。</p>}
            </section>
          )}
        </div>
      )}
      {confirm && s && (
        <ConfirmSheet title={`重置 ${s.name} 的密码？`} confirm="重置密码" onClose={() => setConfirm(false)} onConfirm={reset}
          text={<>密码恢复为 a12345678，{s.name} 下次登录时需要设置新密码；已登录的设备会退出登录。</>} />
      )}
    </Desk>
  );
}
