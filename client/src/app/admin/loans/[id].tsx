import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import {
  Avatar, ConfirmSheet, CreditPausedNotice, Desk, Icon, KvLoading, LOAN_TAGS, Notice, PERIOD_TAGS, PersonLoading, SkeletonGroup, Stats, Summary, Toast, useLoanSettings,
} from '@/components';
import { classOf } from '@/lib/counter';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatCenti, formatTime } from '@/lib/format';
import { periodLines, planText, rateText, type Loan, type LoanPeriod } from '@/lib/loans';
import { penaltyRate } from '@/lib/rates';
import { call } from '@/lib/rpc';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { monthDay } from '@/lib/term';

type Payment = {
  txn_id: string; interest: number; principal: number; auto: boolean;
  txns: { txn_no: string; created_at: string; amount: number; payment: 'account' | 'cash'; status: string; operator: { display_name: string } | null } | null;
};
type Detail = Loan & {
  students: { name: string; class_label: string | null; class_no: number; cohort: number } | null; loan_periods: LoanPeriod[]; loan_payments: Payment[];
  operator: { display_name: string } | null; terminator: { display_name: string } | null;
};
const SELECT = '*, students(name,class_label,class_no,cohort), loan_periods(*), '
  + 'loan_payments(*, txns(txn_no,created_at,amount,payment,status,operator:profiles!txns_operator_id_fkey(display_name))), '
  + 'operator:profiles!loans_operator_id_fkey(display_name), terminator:profiles!loans_terminated_by_fkey(display_name)';

// One loan (design system Loan, 后台“贷款”页), one column at every width: the student, the four figures, how it was
// paid out, the plan and every repayment. The president and the bank admin may terminate a loan still being paid back: a reason, then a second look.
export default function LoanPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe().data!;
  const terminates = me.roles.includes('president') || me.roles.includes('teacher');
  const queryClient = useQueryClient();
  const settings = useLoanSettings();
  const loan = useQuery({
    queryKey: ['admin-loans', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('loans').select(SELECT).eq('id', id).maybeSingle();
      if (error) throw error;
      return data as unknown as Detail | null;
    },
  });
  const [terminating, setTerminating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const l = loan.data;
  const payments = (l?.loan_payments ?? []).filter((p) => p.txns).sort((a, b) => a.txns!.created_at.localeCompare(b.txns!.created_at));
  const paidInterest = payments.filter((p) => p.txns!.status === 'normal').reduce((s, p) => s + p.interest, 0);

  return (
    <Desk title="贷款" back={() => router.navigate('/admin/loans' as Href)}>
      <CreditPausedNotice />
      {loan.isError && <Notice tone="danger" title="暂时无法读取这笔贷款">请检查网络后刷新页面。</Notice>}
      {loan.isPending && <SkeletonGroup className="dc-stack"><PersonLoading side /><KvLoading rows={4} /></SkeletonGroup>}
      {loan.data === null && <Notice tone="danger" title="未找到这笔贷款">请返回贷款列表重新查找。</Notice>}
      {l && (
        <>
          <div className="dc-stack dc-enter">
            <div className="dc-person">
              <Avatar role="student" lg className="dc-person-avatar" />
              <div className="dc-person-main">
                <div className="dc-person-name">{l.students?.name} {LOAN_TAGS[l.status]}</div>
                <div className="dc-person-meta">{l.students && classOf(l.students)} · 学号 {l.student_no}</div>
              </div>
              {terminates && !l.terminated_at && (l.status === 'active' || l.status === 'overdue') && (
                <button className="dc-btn dc-btn-ghost dc-btn-sm is-danger" type="button" onClick={() => setTerminating(true)}>终止贷款</button>
              )}
            </div>
            {l.terminated_at && (
              <Notice title={`${formatTime(l.terminated_at).split(' ')[0]} 由 ${l.terminator?.display_name ?? ''} 终止：${l.terminate_reason ?? ''}`} />
            )}
            <Stats items={[
              ['本金', formatAmount(l.principal), 'HTB'], ['剩余本金', formatAmount(l.remaining), 'HTB'],
              ['已付利息', formatAmount(paidInterest), 'HTB'], ['已产生利息', formatCenti(l.interest_centi), 'HTB'],
            ]} />
          </div>
          <div className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties}>
            <section className="dc-card">
              <h2 className="heading has-gap">放款信息</h2>
              <Summary rows={[
                ['贷款号', l.loan_no], ['放款日', monthDay(l.opened_on)], ['经办人', l.operator?.display_name ?? ''], ['用途', l.purpose],
                ['还款方式', planText(l.plan, l.periods)],
                ['周利率', `${rateText(l.rate)}${settings ? ` · 罚息 ${rateText(penaltyRate(l.rate, settings.multiplier))}` : ''}`],
                ['放款时信用分', `${l.score} 分`], ['放款方式', l.disbursed_via === 'account' ? '存入账户' : '付现金'],
              ]} />
            </section>
            <section className="dc-card">
              <h2 className="heading has-gap">还款计划</h2>
              <div className="dc-table-scroll">
                <table className="dc-table" aria-label="还款计划">
                  <thead><tr><th scope="col">期</th><th scope="col">应还日</th><th scope="col" className="n">应还本金</th><th scope="col" className="n">已还本金</th><th scope="col">状态</th></tr></thead>
                  <tbody>
                    {periodLines(l.loan_periods, l.plan).map((p) => {
                      const row = l.loan_periods.find((x) => x.seq === p.seq)!;
                      return (
                        <tr key={p.seq}>
                          <td>{p.seq}</td><td>{monthDay(row.due_on)}</td><td className="n">{formatAmount(row.principal)}</td><td className="n">{formatAmount(row.paid)}</td>
                          <td>{l.status === 'reversed' ? '—' : PERIOD_TAGS[p.tag]}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <section className="dc-card dc-enter" style={{ '--i': 2 } as React.CSSProperties}>
            <h2 className="heading has-gap">还款记录</h2>
            {!payments.length ? <p className="dc-top-sub">还没有还款。</p> : (
              <div className="dc-table-scroll">
                <table className="dc-table" aria-label="还款记录">
                  <thead>
                    <tr>
                      <th scope="col">时间</th><th scope="col">交易号</th><th scope="col" className="n">金额</th><th scope="col" className="n">其中利息</th>
                      <th scope="col" className="n">其中本金</th><th scope="col">方式</th><th scope="col">经办人</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => {
                      const t = p.txns!;
                      return (
                        <tr key={p.txn_id}>
                          <td>{formatTime(t.created_at)}</td><td>{t.txn_no}{t.status === 'reversed' && '（已冲正）'}</td>
                          <td className="n">{formatAmount(t.amount)}</td><td className="n">{formatAmount(p.interest)}</td><td className="n">{formatAmount(p.principal)}</td>
                          <td>{p.auto ? '自动扣款' : t.payment === 'cash' ? '现金' : '账户'}</td><td>{p.auto ? '系统' : t.operator?.display_name}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {terminating && l && (
        <TerminateSheets loan={l} onClose={() => setTerminating(false)} onDone={() => {
          setTerminating(false);
          setToast('已终止');
          queryClient.invalidateQueries({ queryKey: ['admin-loans'] });
        }} />
      )}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </Desk>
  );
}

// 终止贷款: the reason (required, at most 100 characters), then a second look at what falls due; a refusal stays in the sheet.
function TerminateSheets({ loan, onClose, onDone }: { loan: Detail; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const name = loan.students?.name ?? `学号 ${loan.student_no}`;

  async function terminate() {
    setBusy(true);
    setError(null);
    try {
      await call('terminate_loan', { p_loan_id: loan.id, p_reason: reason.trim() });
      onDone();
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('');
      setError(explain(err.code, err.detail.field === 'reason' ? { ...err.detail, field: 'terminate_reason' } : err.detail));
      setBusy(false);
    }
  }

  if (sure) {
    return (
      <ConfirmSheet title={`终止${name}的贷款？`} confirm="确认终止" busy={busy} onConfirm={terminate} onClose={() => { setSure(false); setError(null); }}
        text={`剩余本金 ${formatAmount(loan.remaining)} HTB 和已产生利息 ${formatCenti(loan.interest_centi)} HTB 立即全部到期：先从活期扣，不够的部分算逾期。`}>
        {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      </ConfirmSheet>
    );
  }
  return (
    <ConfirmSheet title="终止贷款" confirm="下一步" ready={!!reason.trim()} onConfirm={() => setSure(true)} onClose={onClose}>
      <label className="dc-field">
        <span className="dc-field-label"><Icon name="help" />原因</span>
        <span className="dc-input-wrap dc-input-area">
          <textarea className="dc-input" rows={3} maxLength={100} value={reason} placeholder="写清楚终止的原因" onChange={(e) => setReason(e.target.value)} />
        </span>
        <span className="dc-field-hint">必填，最多 100 字</span>
      </label>
    </ConfirmSheet>
  );
}
