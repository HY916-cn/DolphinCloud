import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  CounterPage, DepositPanel, FindStudent, Icon, ResultView, ShopPanel, WithdrawPanel, servedAmount, type IconName, type Served,
} from '@/components';
import { classOf, lookupStudent, useSettings, type Student } from '@/lib/counter';
import { formatAmount } from '@/lib/format';
import { useOnline } from '@/lib/online';

const BUSINESSES: [Business, IconName, string][] = [['deposit', 'deposit', '存款'], ['withdraw', 'withdraw', '取款'], ['shop', 'exchange', '兑换']];
type Business = 'deposit' | 'withdraw' | 'shop';
const STATUS: Record<string, string> = { frozen: '已冻结', graduated: '已毕业' };

// 办理 (PHASE-1.md §7.5, design system CounterServicePage): find and confirm the student once, then any number of
// deposits, withdrawals and exchanges for them; each finished one goes onto the 办理单 and the balance is read
// again. 结束办理 shows the whole visit. Offline only 存款 is open (§7.7). `?b=` picks the first business.
export default function Serve() {
  const online = useOnline();
  const settings = useSettings();
  const { b } = useLocalSearchParams<{ b?: string }>();
  const first = BUSINESSES.find(([k]) => k === b)?.[0] ?? 'deposit';
  const [student, setStudent] = useState<Student | null>(null);
  const [business, setBusiness] = useState<Business>(first);
  const [served, setServed] = useState<Served[]>([]);
  const [finished, setFinished] = useState(false);
  const current: Business = online ? business : 'deposit';

  const refresh = (no: string) => lookupStudent(no).then(setStudent, () => {}); // a stale balance is checked again by the server
  // A student found offline has no balance yet; read it once the counter is back online.
  useEffect(() => {
    if (online && student && student.balance === null) refresh(student.student_no);
  }, [online, student]);

  function reset() {
    setStudent(null);
    setServed([]);
    setFinished(false);
    setBusiness(first);
  }
  const end = () => (served.length ? setFinished(true) : reset());

  function done(s: Served) {
    setServed((list) => [...list, s]);
    if (online) refresh(student!.student_no);
  }

  if (!student) {
    return (
      <CounterPage title="办理">
        <FindStudent offline={!online} onFound={setStudent} />
      </CounterPage>
    );
  }

  if (finished) {
    return (
      <CounterPage title="办理">
        <ResultView title="办理完成" onNext={reset}
          lead={<>为 <b>{student.name}</b> 办理了 {served.length} 笔业务{student.balance !== null && <>，当前余额 <b>{formatAmount(student.balance)}</b> HTB</>}</>}
          rows={served.map((s) => [`${s.label} ${servedAmount(s)}`, s.txnNo ? `交易号 ${s.txnNo}` : '联网后入账'])} />
      </CounterPage>
    );
  }

  const daily = settings.daily[student.division];
  const left = daily === undefined || student.withdrawn_today === null ? null : Math.max(daily - student.withdrawn_today, 0);
  const props = { student, served, onDone: done, onEnd: end };
  return (
    <CounterPage title="办理" onBack={end}>
      <div className="dc-person">
        <span className="dc-person-avatar"><Icon name="me" /></span>
        <div className="dc-person-main">
          <div className="dc-person-name">{student.name}</div>
          <div className="dc-person-meta">{classOf(student)} · 学号 {student.student_no}</div>
          <div className="dc-person-meta">
            {left === null ? '离线时不显示余额' : `今日还可取 ${formatAmount(left)} HTB`}{STATUS[student.status] && ` · 账户${STATUS[student.status]}`}
          </div>
        </div>
        {student.balance !== null && <div className="dc-person-side">{formatAmount(student.balance)}<small>当前余额 HTB</small></div>}
        {!served.length && <button className="dc-btn dc-btn-secondary dc-btn-sm dc-hide-phone" type="button" onClick={reset}>换一位</button>}
      </div>
      <fieldset className="dc-seg" aria-label="业务">
        {BUSINESSES.map(([key, icon, label]) => (
          <label key={key} style={!online && key !== 'deposit' ? { opacity: 0.4 } : undefined}>
            <input type="radio" name="business" checked={current === key} disabled={!online && key !== 'deposit'}
              onChange={() => setBusiness(key)} />
            <span><Icon name={icon} />{label}</span>
          </label>
        ))}
      </fieldset>
      {current === 'deposit' && <DepositPanel {...props} />}
      {current === 'withdraw' && <WithdrawPanel {...props} />}
      {current === 'shop' && <ShopPanel {...props} />}
    </CounterPage>
  );
}
