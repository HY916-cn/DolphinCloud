import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Avatar, CounterPage, DepositPanel, DutyCard, FindStudent, Icon, Notice, QueryPanel, ReversalSheet, ShopPanel, WithdrawPanel, servedAmount, type IconName, type Served,
} from '@/components';
import { classOf, lookupStudent, useMyDay, useSettings, type Student, type TxnResult } from '@/lib/counter';
import { useDuty } from '@/lib/duty';
import { formatAmount } from '@/lib/format';
import { useRolling } from '@/lib/motion';
import type { RosterEntry } from '@/lib/offline-queue';
import { useOnline } from '@/lib/online';
import { useMe } from '@/lib/session';

const BUSINESSES: [Business, IconName, string][] = [
  ['deposit', 'deposit', '存款'], ['withdraw', 'withdraw', '取款'], ['shop', 'exchange', '兑换'], ['query', 'query', '查询'],
];
type Business = 'deposit' | 'withdraw' | 'shop' | 'query';
const STATUS: Record<string, string> = { frozen: '已冻结', graduated: '已毕业' };

// PersonCard's balance, rolling to its new value after a business.
function StudentBalance({ amount }: { amount: number }) {
  return <div className="dc-person-side">{formatAmount(useRolling(amount))}<small>当前余额 HTB</small></div>;
}

// 办理 (PHASE-1.md §7.5, design system CounterServicePage): the counter's one page. Search and tap a student (or one
// served earlier today), then any number of deposits, withdrawals and exchanges for them, and 查询 for their account
// and every transaction; each goes onto the 办理单
// with its 冲正, and the balance is read again. 结束办理 comes back here with the visit summed up and the search
// ready for the next student. Offline only 存款 is open (§7.7). `?s=<学号>` opens that student (from 今日业务). The
// counter opens once the teller is on duty (上班).
export default function Serve() {
  const me = useMe().data!;
  const online = useOnline();
  const settings = useSettings();
  const queryClient = useQueryClient();
  const day = useMyDay(me.profile.id, online);
  const duty = useDuty(me.profile.id);
  const { s: preset } = useLocalSearchParams<{ s?: string }>();
  const [student, setStudent] = useState<Student | null>(null);
  const [business, setBusiness] = useState<Business>('deposit');
  const [served, setServed] = useState<Served[]>([]);
  const [last, setLast] = useState<{ name: string; served: Served[]; balance: number | null } | null>(null);
  const [reversing, setReversing] = useState<Served | null>(null);
  const current: Business = online ? business : 'deposit';

  const refresh = (no: string) => lookupStudent(no).then(setStudent, () => {}); // a stale balance is checked again by the server
  const changed = () => queryClient.invalidateQueries({ queryKey: ['my-day', me.profile.id] });
  // A student found offline has no balance yet; read it once the counter is back online.
  useEffect(() => {
    if (online && student && student.balance === null) refresh(student.student_no);
  }, [online, student]);
  // The preset opens once the counter is online; a visit already open (or ended, which drops ?s=) is left alone.
  useEffect(() => {
    if (preset && online && !student) lookupStudent(preset).then(begin, () => {});
    // Not student: opening or ending a visit must not open the preset again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, online]);

  // Today's students, newest first, for a second visit without searching.
  const recent = useMemo(() => {
    const seen = new Map<string, RosterEntry>();
    for (const t of day.data ?? []) {
      if (t.students && !seen.has(t.student_no)) seen.set(t.student_no, { student_no: t.student_no, ...t.students });
    }
    return [...seen.values()].slice(0, 6);
  }, [day.data]);

  function begin(s: Student) {
    setStudent(s);
    setServed([]);
    setBusiness('deposit');
    setLast(null);
  }
  function end() {
    if (served.length) setLast({ name: student!.name, served, balance: student!.balance });
    setStudent(null);
    setServed([]);
    if (preset) router.replace('/counter');
  }
  function done(s: Served) {
    setServed((list) => [...list, s]);
    if (online) refresh(student!.student_no);
    changed();
  }
  function reversed(r: TxnResult) {
    setServed((list) => list.map((s) => (s === reversing ? { ...s, reversed: true } : s)));
    setStudent((s) => s && { ...s, balance: r.balance_after });
    setReversing(null);
    refresh(student!.student_no);
    changed();
  }

  // Closed until the server says the teller is on duty. Offline with no answer yet (a new device that lost the network
  // first), it opens for offline deposits only: the server takes those without 上班 (require_duty).
  if (!student && !duty.data && (online || duty.data === null)) {
    return <CounterPage title="办理"><DutyCard me={me} whole /></CounterPage>;
  }
  if (!student) {
    return (
      <CounterPage title="办理">
        {last && (
          <Notice tone="success" title={`${last.name}：办理完成`}>
            {last.served.map((s) => `${s.label} ${servedAmount(s)}${s.reversed ? '（已冲正）' : ''}`).join('；')}
            {last.balance !== null && `。当前余额 ${formatAmount(last.balance)} HTB`}
          </Notice>
        )}
        <FindStudent offline={!online} onFound={begin} recent={online ? recent : []} />
      </CounterPage>
    );
  }

  const daily = settings.daily[student.division];
  const left = daily === undefined || student.withdrawn_today === null ? null : Math.max(daily - student.withdrawn_today, 0);
  const props = { student, served, onDone: done, onEnd: end, onReverse: setReversing };
  return (
    <CounterPage title="办理" onBack={end}>
      <div className="dc-person">
        <Avatar role="student" lg className="dc-person-avatar" />
        <div className="dc-person-main">
          <div className="dc-person-name">{student.name}</div>
          <div className="dc-person-meta">{classOf(student)} · 学号 {student.student_no}</div>
          <div className="dc-person-meta">
            {left === null ? '离线时不显示余额' : `今日还可取 ${formatAmount(left)} HTB`}{STATUS[student.status] && ` · 账户${STATUS[student.status]}`}
          </div>
        </div>
        {student.balance !== null && <StudentBalance key={student.student_no} amount={student.balance} />}
        <button className="dc-btn dc-btn-secondary dc-btn-sm dc-hide-phone" type="button" onClick={end}>{served.length ? '结束办理' : '换一位'}</button>
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
      {current === 'query' && <QueryPanel {...props} />}
      {reversing && (
        <ReversalSheet txn={{ id: reversing.txnId!, txn_no: reversing.txnNo!, what: `${student.name} · ${reversing.label} ${servedAmount(reversing)}` }}
          onClose={() => setReversing(null)} onDone={reversed} />
      )}
    </CounterPage>
  );
}
