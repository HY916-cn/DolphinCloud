import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  CounterPage, DepositPanel, FindStudent, Icon, LookupPanel, PersonCard, ResultView, ReversalPanel, ShopPanel, Steps,
  WithdrawPanel, type Served,
} from '@/components';
import { lookupStudent, type Student } from '@/lib/counter';
import { formatAmount } from '@/lib/format';
import { useOnline } from '@/lib/online';

const STEPS = ['识别学生', '办理业务', '完成'];
const TABS = [['deposit', '存款'], ['withdraw', '取款'], ['shop', '兑换'], ['lookup', '查询'], ['reversal', '冲正']] as const;
type Tab = (typeof TABS)[number][0];

// 办理 (PHASE-1.md §7.5): find and confirm the student once, then any number of businesses for them, each from
// its tab; the balance is read again after each one. 结束办理 shows everything done in this visit. Offline only
// 存款 is open (§7.7). `?b=` opens a business tab first (the overview's tiles).
export default function Serve() {
  const online = useOnline();
  const { b } = useLocalSearchParams<{ b?: string }>();
  const first: Tab = TABS.find(([k]) => k === b)?.[0] ?? 'deposit';
  const [student, setStudent] = useState<Student | null>(null);
  const [tab, setTab] = useState<Tab>(first);
  const [served, setServed] = useState<Served[]>([]);
  const [finished, setFinished] = useState(false);
  const current: Tab = online ? tab : 'deposit';

  const refresh = (no: string) => lookupStudent(no).then(setStudent, () => {}); // a stale balance is checked again by the server
  // A student found offline has no balance yet; read it once the counter is back online.
  useEffect(() => {
    if (online && student && student.balance === null) refresh(student.student_no);
  }, [online, student]);

  function reset() {
    setStudent(null);
    setServed([]);
    setFinished(false);
    setTab(first);
  }
  const end = () => (served.length ? setFinished(true) : reset());

  function done(s: Served) {
    setServed((list) => [...list, s]);
    if (online) refresh(student!.student_no);
  }

  if (!student) {
    return (
      <CounterPage title="办理">
        <Steps names={STEPS} current={0} />
        <FindStudent offline={!online} onFound={setStudent} />
      </CounterPage>
    );
  }

  if (finished) {
    return (
      <CounterPage title="办理">
        <Steps names={STEPS} current={2} />
        <ResultView title="办理完成" onNext={reset}
          lead={<>为 <b>{student.name}</b> 办理了 {served.length} 项业务{student.balance !== null && <>，当前余额 <b>{formatAmount(student.balance)}</b> HTB</>}</>}
          rows={served.map((s) => [s.label, s.txnNo ? `交易号 ${s.txnNo}` : '联网后入账'])} />
      </CounterPage>
    );
  }

  const last = served[served.length - 1];
  return (
    <CounterPage title="办理" onBack={end}>
      <Steps names={STEPS} current={1} />
      <PersonCard student={student} />
      {last && (
        <div className="dc-notice dc-notice-success" role="status">
          <Icon name="success" />
          <div style={{ flex: 1 }}>
            <p className="dc-notice-title">{last.label}，已办理</p>
            <p className="dc-notice-text">{last.lead}。本次已办理 {served.length} 项，可以继续办理其他业务。</p>
          </div>
          <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={end}>结束办理</button>
        </div>
      )}
      <div className="dc-tabs" role="tablist" aria-label="业务">
        {TABS.map(([key, label]) => (
          <button key={key} className="dc-tabs-item" type="button" role="tab" aria-selected={current === key}
            disabled={!online && key !== 'deposit'} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {current === 'deposit' && <DepositPanel student={student} onDone={done} onEnd={end} />}
      {current === 'withdraw' && <WithdrawPanel student={student} onDone={done} onEnd={end} />}
      {current === 'shop' && <ShopPanel student={student} onDone={done} onEnd={end} />}
      {current === 'lookup' && <LookupPanel student={student} onEnd={end} />}
      {current === 'reversal' && <ReversalPanel student={student} onDone={done} onEnd={end} />}
    </CounterPage>
  );
}
