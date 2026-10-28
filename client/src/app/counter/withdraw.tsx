import { useState } from 'react';
import { ConfirmSheet, CounterPage, FindStudent, Icon, NeedsNetwork, Notice, PersonCard, ResultView, Steps, Summary } from '@/components';
import { describeCash, makeChange } from '@/lib/cash';
import { classOf, newId, useSettings, withdraw, type Student, type TxnResult } from '@/lib/counter';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatTime } from '@/lib/format';
import { useOnline } from '@/lib/online';
import { useMe } from '@/lib/session';

const STEPS = ['识别学生', '输入金额', '核对信息', '完成'];

// 取款 (PHASE-1.md §7.5): the amount, the notes to pay out, and what is still allowed today.
export default function Withdraw() {
  const me = useMe().data!;
  const online = useOnline();
  const settings = useSettings();
  const [student, setStudent] = useState<Student | null>(null);
  const [text, setText] = useState('');
  const [id, setId] = useState(newId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const [done, setDone] = useState<TxnResult | null>(null);
  const amount = Number(text) || 0;

  function reset() {
    setStudent(null);
    setText('');
    setId(newId());
    setError(null);
    setDone(null);
  }

  async function submit() {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      setDone(await withdraw(id, student!.student_no, amount));
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('');
      setError(explain(err.code, err.detail));
    } finally {
      setBusy(false);
    }
  }

  if (!online && !done) {
    return (
      <CounterPage title="取款">
        <NeedsNetwork business="取款" />
      </CounterPage>
    );
  }

  if (done) {
    return (
      <CounterPage title="取款">
        <Steps names={STEPS} current={3} />
        <ResultView title="取款成功" onNext={reset}
          lead={<>取款 <b>{formatAmount(done.amount)} HTB</b>，当前余额 <b>{formatAmount(done.balance_after)}</b> HTB</>}
          rows={[
            ['学生', `${student!.name} · ${classOf(student!)}`],
            ['配钞', describeCash(makeChange(done.amount, settings.denominations))],
            ['经办柜员', me.profile.display_name],
            ['办理时间', formatTime(done.created_at)],
            ['交易号', done.txn_no],
          ]} />
      </CounterPage>
    );
  }

  if (!student) {
    return (
      <CounterPage title="取款">
        <Steps names={STEPS} current={0} />
        <FindStudent onFound={setStudent} />
      </CounterPage>
    );
  }

  const balance = student.balance ?? 0;
  const single = settings.single[student.division];
  const daily = settings.daily[student.division];
  const todayLeft = daily === undefined ? undefined : Math.max(daily - (student.withdrawn_today ?? 0), 0);
  // Checked again by withdraw(); shown here so the teller sees the reason before confirming.
  const problem =
    !amount ? null
    : amount > balance ? `余额不足：可用余额 ${formatAmount(balance)} HTB`
    : single !== undefined && amount > single ? `超过单笔取款限额 ${formatAmount(single)} HTB`
    : todayLeft !== undefined && amount > todayLeft ? `超过今日取款限额：今日还可取款 ${formatAmount(todayLeft)} HTB`
    : null;
  const payout = describeCash(makeChange(amount, settings.denominations));

  return (
    <CounterPage title="取款" onBack={reset}>
      <Steps names={STEPS} current={confirming ? 2 : 1} />
      <div className="dc-split">
        <section className="dc-stack">
          <PersonCard student={student} />
          <label className={`dc-field ${problem ? 'is-error' : ''}`}>
            <span className="dc-field-label"><Icon name="withdraw" />取款金额</span>
            <span className="dc-input-wrap">
              <input className="dc-input" inputMode="numeric" autoFocus value={text} placeholder="请输入金额"
                onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              <span className="dc-input-unit">HTB</span>
            </span>
            <span className="dc-field-hint">
              {problem ? <><Icon name="warning" />{problem}</> : amount ? `配钞：${payout}` : `单笔最多 ${single ?? '—'} HTB`}
            </span>
          </label>
        </section>
        <aside className="dc-card is-sticky dc-hide-phone">
          <h2 className="heading" style={{ margin: '0 0 var(--space-2)' }}>核对金额</h2>
          <Summary rows={[
            ['配钞方案', amount ? payout : '—'],
            ['可用余额', `${formatAmount(balance)} HTB`],
            ['今日还可取', todayLeft === undefined ? '—' : `${formatAmount(todayLeft)} HTB`],
            ['取款后余额', `${formatAmount(Math.max(balance - amount, 0))} HTB`],
          ]} total={['合计取款', amount]} />
        </aside>
      </div>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <div className="dc-actions">
        <button className="dc-btn dc-btn-secondary dc-hide-phone" type="button" onClick={reset}>上一步</button>
        <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button"
          disabled={!busy && (!amount || !!problem)} onClick={() => setConfirming(true)}>
          {busy ? '正在取款' : !amount ? '请输入金额' : problem ? '金额超出可取范围' : '确认取款'}
        </button>
        <div className="dc-actions-total">
          <span>合计取款<small>取款后余额 {formatAmount(Math.max(balance - amount, 0))} HTB</small></span>
          <b>{formatAmount(amount)}<small>HTB</small></b>
        </div>
      </div>
      {confirming && (
        <ConfirmSheet title="确认取款" confirm="确认取款" onClose={() => setConfirming(false)} onConfirm={submit}
          text={<>为 <b>{student.name}</b> 取款 <b>{formatAmount(amount)} HTB</b>，配钞 {payout}</>} />
      )}
    </CounterPage>
  );
}
