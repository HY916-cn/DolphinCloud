import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ConfirmSheet, Desk, Icon, KvLoading, link, Notice, PersonLoading, SkeletonGroup, Summary, TxnList, TxnListLoading } from '@/components';
import { classOf } from '@/lib/counter';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatTime } from '@/lib/format';
import { call } from '@/lib/rpc';
import { useMe } from '@/lib/session';
import { DIVISION, STATUS, useStudent, type AdminStudent } from '@/lib/students';
import { supabase } from '@/lib/supabase';
import { toTxn, type TxnRow } from '@/lib/txns';

type Status = AdminStudent['status'];
// The changes open from each status (set_student_status): a frozen account is unfrozen; a graduate can be restored.
const NEXT: Record<Status, Status[]> = { normal: ['frozen', 'graduated'], frozen: ['normal'], graduated: ['normal'] };
type Change = { label: (s: AdminStudent) => string; title: (s: AdminStudent) => string; text: (s: AdminStudent) => string; done: string };
const CHANGE: Record<Status, Change> = {
  frozen: {
    label: () => '冻结账户', title: (s) => `冻结${s.name}的账户？`, done: '账户已冻结',
    text: (s) => `冻结后柜台不能为${s.name}办理存款、取款和兑换，余额保留；之后可以随时解冻。`,
  },
  graduated: {
    label: () => '标记毕业', title: (s) => `把${s.name}标记为已毕业？`, done: '已标记毕业',
    text: (s) => `标记后柜台不能再为${s.name}办理业务，余额保留；标记错了可以恢复为在读。`,
  },
  normal: {
    label: (s) => (s.status === 'frozen' ? '解冻账户' : '恢复为在读'),
    title: (s) => (s.status === 'frozen' ? `解冻${s.name}的账户？` : `把${s.name}恢复为在读？`), done: '账户已恢复正常',
    text: (s) => `恢复后柜台可以继续为${s.name}办理业务。`,
  },
};

// One student: who they are, whether they have signed in, the latest movements with the way to all of them in 流水
// (teacher), 重置密码, and freezing, unfreezing or marking them graduated (teacher; the counter then refuses them).
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
        .eq('student_no', no).order('seq', { ascending: false }).limit(10);
      if (error) throw error;
      return (data as TxnRow[]).map(toTxn);
    },
  });
  const [confirm, setConfirm] = useState<'reset' | Status | null>(null);
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; title: string; text: string } | null>(null);
  const s = student.data;

  async function run(action: 'reset' | Status) {
    setConfirm(null);
    try {
      if (action === 'reset') {
        const r = await call<{ password: string }>('reset_password', { p_user_id: s!.user_id });
        setResult({ tone: 'success', title: '密码已重置', text: `新的初始密码：${r.password}。请转交${s!.name}，下次登录时需要设置新密码；这个密码只显示这一次。` });
      } else {
        await call('set_student_status', { p_student_no: s!.student_no, p_status: action });
        setResult({ tone: 'success', title: CHANGE[action].done, text: '' });
      }
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
                <div className="dc-person-name">
                  {s.name}
                  {s.status !== 'normal' && <> <span className="dc-tag dc-tag-danger"><Icon name="warning" />{STATUS[s.status]}</span></>}
                </div>
                <div className="dc-person-meta"><span>{classOf(s)}</span> · <span>{s.cohort} 届</span> · <span>学号 {s.student_no}</span></div>
              </div>
              {s.accounts && <div className="dc-person-side">{formatAmount(s.accounts.balance)}<small>当前余额 HTB</small></div>}
            </div>
            {result && <Notice tone={result.tone} title={result.title}>{result.text || undefined}</Notice>}
            <div className="dc-card">
              <Summary rows={[
                ['学部', DIVISION[s.division]],
                ['账户状态', STATUS[s.status]],
                ['登录', s.profiles?.disabled ? '已停用' : s.profiles?.must_change_password ? '还未设置新密码' : '已设置新密码'],
                ['开户时间', formatTime(s.opened_at)],
              ]} />
            </div>
            <button className="dc-btn dc-btn-secondary" type="button" onClick={() => { setResult(null); setConfirm('reset'); }}>重置密码</button>
            {teacher && NEXT[s.status].map((to) => (
              <button key={to} className={`dc-btn dc-btn-ghost ${to === 'normal' ? '' : 'is-danger'}`} type="button"
                onClick={() => { setResult(null); setConfirm(to); }}>{CHANGE[to].label(s)}</button>
            ))}
          </div>
          {teacher && (
            <section className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties}>
              <div className="dc-section-head">
                <h2 className="heading">最近交易</h2>
                <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link(`/admin/txns?student=${s.student_no}`)}>查看全部流水<Icon name="next" /></a>
              </div>
              {!txns.data ? <TxnListLoading /> : txns.data.length ? <TxnList items={txns.data} /> : <p className="dc-top-sub">还没有交易记录。</p>}
            </section>
          )}
        </div>
      )}
      {confirm === 'reset' && s && (
        <ConfirmSheet title={`重置 ${s.name} 的密码？`} confirm="重置密码" onClose={() => setConfirm(null)} onConfirm={() => run('reset')}
          text={<>将生成新的初始密码，只在这里显示一次；{s.name} 下次登录时需要设置新密码，已登录的设备会退出登录。</>} />
      )}
      {confirm && confirm !== 'reset' && s && (
        <ConfirmSheet title={CHANGE[confirm].title(s)} confirm={CHANGE[confirm].label(s)} onClose={() => setConfirm(null)}
          onConfirm={() => run(confirm)} text={CHANGE[confirm].text(s)} />
      )}
    </Desk>
  );
}
