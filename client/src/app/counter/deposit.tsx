import { useState } from 'react';
import { CashCounter, ConfirmSheet, CounterPage, FindStudent, Notice, PersonCard, ResultView, Steps, Summary } from '@/components';
import { cashTotal, describeCash, nonEmpty, type Counts } from '@/lib/cash';
import { classOf, deposit, newId, useSettings, type Student, type TxnResult } from '@/lib/counter';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatTime } from '@/lib/format';
import { offlineQueue } from '@/lib/offline-queue';
import { useOnline } from '@/lib/online';
import { useMe } from '@/lib/session';
import { useQueryClient } from '@tanstack/react-query';

const STEPS = ['识别学生', '录入面额', '核对信息', '完成'];

// 存款 (PHASE-1.md §7.5): find the student, count the notes, confirm, done. Offline, or when the call gets no
// answer, the deposit is registered on this device and uploaded later under the same id (§7.7).
export default function Deposit() {
  const me = useMe().data!;
  const online = useOnline();
  const { denominations } = useSettings();
  const queryClient = useQueryClient();
  const [student, setStudent] = useState<Student | null>(null);
  const [counts, setCounts] = useState<Counts>({});
  const [id, setId] = useState(newId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const [done, setDone] = useState<{ result: TxnResult | null; at: string } | null>(null);
  const amount = cashTotal(counts);

  function reset() {
    setStudent(null);
    setCounts({});
    setId(newId());
    setError(null);
    setDone(null);
  }

  async function submit() {
    setConfirming(false);
    setBusy(true);
    setError(null);
    const at = new Date().toISOString();
    const queue = () => offlineQueue.add({
      id, student_no: student!.student_no, name: student!.name, class: classOf(student!), cash: nonEmpty(counts), amount,
      operator_id: me.profile.id, operator_name: me.profile.display_name, created_at: at,
    }).then(() => queryClient.invalidateQueries({ queryKey: ['offline-deposits'] }));
    try {
      if (!online) {
        await queue();
        setDone({ result: null, at });
      } else {
        setDone({ result: await deposit(id, student!.student_no, nonEmpty(counts)), at });
      }
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('');
      if (err.code === 'NETWORK') {
        await queue();
        setDone({ result: null, at });
      } else {
        setError(explain(err.code, err.detail));
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const rows: [string, React.ReactNode][] = [
      ['学生', `${student!.name} · ${classOf(student!)}`],
      ['面额', describeCash(counts)],
      ['经办柜员', me.profile.display_name],
      ['办理时间', formatTime(done.result?.created_at ?? done.at)],
      ['交易号', done.result?.txn_no ?? '联网后生成'],
    ];
    return (
      <CounterPage title="存款">
        <Steps names={STEPS} current={3} />
        {done.result ? (
          <ResultView title="存款成功" rows={rows} onNext={reset}
            lead={<>存入 <b>{formatAmount(amount)} HTB</b>，当前余额 <b>{formatAmount(done.result.balance_after)}</b> HTB</>} />
        ) : (
          <ResultView title="已登记存款" rows={rows} onNext={reset}
            lead={<>登记 <b>{formatAmount(amount)} HTB</b>，联网后入账</>} />
        )}
      </CounterPage>
    );
  }

  if (!student) {
    return (
      <CounterPage title="存款">
        <Steps names={STEPS} current={0} />
        <FindStudent offline={!online} onFound={setStudent} />
      </CounterPage>
    );
  }

  const after = student.balance === null ? null : student.balance + amount;
  return (
    <CounterPage title="存款" onBack={reset}>
      <Steps names={STEPS} current={confirming ? 2 : 1} />
      <div className="dc-split">
        <section className="dc-stack">
          <PersonCard student={student} />
          <h2 className="heading" style={{ margin: 'var(--space-2) 0 0' }}>按面额录入张数</h2>
          <CashCounter faces={denominations} counts={counts} onChange={setCounts} />
        </section>
        <aside className="dc-card is-sticky dc-hide-phone">
          <h2 className="heading" style={{ margin: '0 0 var(--space-2)' }}>核对金额</h2>
          <Summary
            rows={[
              ...Object.entries(nonEmpty(counts)).sort(([a], [b]) => Number(b) - Number(a))
                .map(([face, n]): [string, React.ReactNode] => [`${face} 元 × ${n} 张`, formatAmount(Number(face) * n)]),
              ...(after === null ? [] : [['存入后余额', `${formatAmount(after)} HTB`] as [string, string]]),
            ]}
            total={['合计存入', amount]} />
        </aside>
      </div>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <div className="dc-actions">
        <button className="dc-btn dc-btn-secondary dc-hide-phone" type="button" onClick={reset}>上一步</button>
        <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button" disabled={!busy && amount <= 0}
          onClick={() => setConfirming(true)}>
          {busy ? '正在存款' : amount > 0 ? '确认存款' : '请录入张数'}
        </button>
        <div className="dc-actions-total">
          <span>合计存入{after !== null && <small>存入后余额 {formatAmount(after)} HTB</small>}</span>
          <b>{formatAmount(amount)}<small>HTB</small></b>
        </div>
      </div>
      {confirming && (
        <ConfirmSheet title="确认存款" confirm="确认存款" onClose={() => setConfirming(false)} onConfirm={submit}
          text={<>为 <b>{student.name}</b> 存款 <b>{formatAmount(amount)} HTB</b>{online ? '' : '（离线登记，联网后入账）'}</>} />
      )}
    </CounterPage>
  );
}
