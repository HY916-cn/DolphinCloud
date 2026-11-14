import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { bindSalaryAccount, SHIFT_STATUS, SHIFTS, usePayroll, weekOf, type Payroll, type Shift, type ShiftRow } from '@/lib/attendance';
import { AppError, explain } from '@/lib/errors';
import { formatTime, shiftDay } from '@/lib/format';
import { call } from '@/lib/rpc';
import { Summary } from './Counter';
import { DatePicker, formatDate, today } from './DatePicker';
import { ConfirmSheet } from './Sheet';
import { Toast } from './Toast';
import { Icon, Notice } from './ui';

const WEEK = '一二三四五六日';
const ORDER: Shift[] = ['am', 'pm'];
// Every refusal here is about attendance and pay, which the error texts are told (`payroll`).
const failure = (e: unknown) => (e instanceof AppError ? explain(e.code, { ...e.detail, payroll: true }) : explain(''));

// A shift's state as a small mark: 中 / 下, coloured by its status, with the words for screen readers beside it.
export function ShiftMark({ shift, row }: { shift: Shift; row?: ShiftRow }) {
  return <i className={`dc-shift is-${row?.status ?? 'none'}`}>{shift === 'am' ? '中' : '下'}</i>;
}
// A registered shift (anyone's but a teller's) that was voided reads 已作废; a teller's not passed, 未通过.
export const statusWord = (row: ShiftRow) => (row.status === 'rejected' && row.role !== 'teller' ? '已作废' : SHIFT_STATUS[row.status]);
export const shiftWords = (shift: Shift, row?: ShiftRow) => `${SHIFTS[shift]}${row ? statusWord(row) : '未上班'}`;

export function ShiftLegend() {
  return (
    <p className="dc-shift-legend" aria-hidden="true">
      {(['confirmed', 'pending', 'rejected', 'none'] as const).map((s) => (
        <span key={s}><i className={`dc-shift is-${s}`}>中</i>{s === 'none' ? '未上班' : SHIFT_STATUS[s]}</span>
      ))}
    </p>
  );
}

const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日`;

// The week shown (Monday to Sunday): the weeks before and after, any day's week from the calendar, and back to 本周.
// `children` go at the row's end.
export function WeekBar({ monday, onMonday }: { monday: string; onMonday: (monday: string) => void }) {
  const now = today();
  const sunday = shiftDay(monday, 6);
  return (
    <div className="dc-weekbar">
      <button className="dc-icon-btn" type="button" aria-label="上一周" onClick={() => onMonday(shiftDay(monday, -7))}><Icon name="back" /></button>
      <DatePicker bare label="选择日期，显示它所在的一周" value={monday} max={now} rule="选一天，显示它所在的一周"
        shown={`${md(monday)} – ${md(sunday)}`} onChange={(d) => onMonday(weekOf(d)[0])} />
      <button className="dc-icon-btn" type="button" aria-label="下一周" disabled={sunday >= now} onClick={() => onMonday(shiftDay(monday, 7))}><Icon name="next" /></button>
      {monday !== weekOf(now)[0] && <button className="dc-btn dc-btn-ghost dc-btn-sm" type="button" onClick={() => onMonday(weekOf(now)[0])}>本周</button>}
    </div>
  );
}

// One teller's week: a row per day with its 中午班 and 下午班, each with its status, when it was signed and its pay.
export function WeekShifts({ monday, rows, names }: { monday: string; rows: ShiftRow[]; names?: Map<string, string> }) {
  const now = today();
  const cell = (shift: Shift, r?: ShiftRow) => {
    if (!r) return <span className="dc-week-cell"><ShiftMark shift={shift} /><span className="dc-top-sub">未上班</span></span>;
    const makeup = r.signed_by !== r.user_id;
    return (
      <span className="dc-week-cell">
        <ShiftMark shift={r.shift} row={r} />
        <span>{statusWord(r)}<small>{makeup ? `${names?.get(r.signed_by) ?? '银行管理员'}补签` : `${formatTime(r.signed_at).split(' ')[1]} 打卡`}
          {r.note && ` · ${r.note}`}{r.pay != null && ` · 已发 ${r.pay} HTB`}</small></span>
      </span>
    );
  };
  return (
    <div className="dc-card">
      <div className="dc-table-scroll">
        <table className="dc-table dc-week" aria-label="本周班次">
          <thead><tr><th scope="col">日期</th><th scope="col">{SHIFTS.am}</th><th scope="col">{SHIFTS.pm}</th></tr></thead>
          <tbody>
            {Array.from({ length: 7 }, (_, i) => shiftDay(monday, i)).filter((d) => d <= now).map((d) => (
              <tr key={d} aria-label={`${md(d)} 星期${WEEK[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7]}：${ORDER.map((s) => shiftWords(s, rows.find((r) => r.day === d && r.shift === s))).join('，')}`}>
                <td className={d === now ? 'is-today' : undefined}>周{WEEK[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7]}<small>{md(d)}</small></td>
                {ORDER.map((s) => <td key={s}>{cell(s, rows.find((r) => r.day === d && r.shift === s))}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ShiftLegend />
    </div>
  );
}

// One day's two shifts: status, when and by whom it was signed in, the bank admin's note, and whether it was paid.
// `action` adds the bank admin's button to each shift; `shifts` limits it to one of them.
export function DayShifts({ day, rows, names, shifts = ORDER, action }: {
  day: string; rows: ShiftRow[]; names?: Map<string, string>; shifts?: Shift[]; action?: (shift: Shift, row?: ShiftRow) => ReactNode;
}) {
  return (
    <div>
      <p className="dc-list-title">{formatDate(day)}</p>
      <ul className="dc-list" aria-label={`${day} 的班次`}>
        {shifts.map((s) => {
          const r = rows.find((x) => x.day === day && x.shift === s);
          const makeup = r && r.signed_by !== r.user_id;
          return (
            <li key={s} className="dc-shift-row">
              <ShiftMark shift={s} row={r} />
              <span className="dc-shift-main">
                <b>{SHIFTS[s]} · {r ? statusWord(r) : '未上班'}</b>
                {r && (
                  <small className="dc-top-sub">
                    {makeup ? `${names?.get(r.signed_by) ?? '银行管理员'}${r.role === 'teller' ? '补签' : '登记'} ${formatTime(r.signed_at)}` : `${formatTime(r.signed_at)} 打卡`}
                    {r.note && ` · ${r.note}`}{r.pay != null && ` · 已发工资 ${r.pay} HTB`}
                  </small>
                )}
              </span>
              {action?.(s, r)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// 工资账户 on 我的 (design system SettingsPage 工作人员的“我的”): where one's own pay goes, bound or changed (更换) in a
// sheet with the student's password, for every counted identity (all but the sysadmin).
export function PayAccount({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const payroll = usePayroll();
  const mine = payroll.data?.find((p) => p.user_id === userId);
  const [open, setOpen] = useState(false);
  const [no, setNo] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const [toast, setToast] = useState(false);

  async function bind() {
    setBusy(true);
    setError(null);
    try {
      await bindSalaryAccount(userId, no.trim(), password);
      await queryClient.invalidateQueries({ queryKey: ['payroll'] });
      setOpen(false);
      setToast(true);
    } catch (err) {
      setError(failure(err));
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  return (
    <section className="dc-stack" aria-label="工资账户">
      <p className="dc-list-title">工资账户</p>
      <div className="dc-card dc-duty">
        <span className="dc-duty-main">
          <b>{payroll.isPending ? '正在读取…' : payroll.isError ? '暂时无法读取工资账户'
            : mine?.account ? `学号 ${mine.account}${mine.students ? ` · ${mine.students.name}` : ''}` : '还没有绑定工资账户'}</b>
          <small className="dc-top-sub">{mine?.account ? '工资按身份和班次发到这个账户' : '绑定后才能参与考勤、领取工资'}</small>
        </span>
        <button className="dc-btn dc-btn-secondary" type="button" disabled={!payroll.data}
          onClick={() => { setNo(''); setError(null); setOpen(true); }}>{mine?.account ? '更换' : '绑定'}</button>
      </div>
      {open && (
        <ConfirmSheet title="绑定工资账户" text="工资会存进这个学生账户。需要账户本人的密码，确认是本人的账户。" confirm="绑定" busy={busy}
          ready={!!no.trim() && !!password} onClose={() => setOpen(false)} onConfirm={bind}>
          <div className="dc-stack">
            {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
            <label className="dc-field">
              <span className="dc-field-label"><Icon name="me" />学号</span>
              <span className="dc-input-wrap"><input className="dc-input" inputMode="numeric" autoComplete="off" value={no} onChange={(e) => setNo(e.target.value)} /></span>
            </label>
            <label className="dc-field">
              <span className="dc-field-label"><Icon name="lock" />这位学生的密码</span>
              <span className="dc-input-wrap"><input className="dc-input" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></span>
              <span className="dc-field-hint">连续输错 5 次，该学生账号会锁定 15 分钟</span>
            </label>
          </div>
        </ConfirmSheet>
      )}
      {toast && <Toast text="已绑定" onDone={() => setToast(false)} />}
    </section>
  );
}

// 工资账户: the student account a staff member's pay goes to, bound with that account's password, by them or by the
// bank admin or sysadmin for them. A counted one changes it by binding another; unbinding waits until they are not.
// `readOnly` (a president): the account, without changing it.
// `admin`: the bank admin or the sysadmin binds without the student's password (PHASE-2.md §5.2).
export function SalaryAccount({ userId, payroll, readOnly, admin }: { userId: string; payroll?: Payroll; readOnly?: boolean; admin?: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [no, setNo] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [unbinding, setUnbinding] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; title: string; text: string } | null>(null);
  const account = payroll?.account;
  const done = () => queryClient.invalidateQueries({ queryKey: ['payroll'] });

  async function bind(e: FormEvent) {
    e.preventDefault();
    if (busy || !no.trim() || (!admin && !password)) return;
    setBusy(true);
    try {
      const r = await bindSalaryAccount(userId, no.trim(), admin ? null : password);
      setResult({ tone: 'success', title: '工资账户已绑定', text: `工资将发到 ${r.name}（学号 ${no.trim()}）的账户。` });
      setEditing(false);
      setNo('');
      await done();
    } catch (err) {
      setResult({ tone: 'danger', ...failure(err) });
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  async function unbind() {
    setUnbinding(false);
    try {
      await call('unbind_salary_account', { p_user_id: userId });
      setResult({ tone: 'success', title: '已解除绑定', text: '绑定新的工资账户之前，工资暂不发放。' });
      await done();
    } catch (err) {
      setResult({ tone: 'danger', ...failure(err) });
    }
  }

  return (
    <section className="dc-stack" aria-label="工资账户">
      <p className="dc-list-title">工资账户</p>
      {result && <Notice tone={result.tone} title={result.title}>{result.text || undefined}</Notice>}
      <div className="dc-card dc-stack">
        {readOnly && !account ? (
          <p className="dc-top-sub">还没有绑定工资账户，工资暂不发放。</p>
        ) : account && !editing ? (
          <>
            <Summary rows={[...(payroll?.students ? [['学生', payroll.students.name] as [string, string]] : []), ['学号', account]]} />
            {!readOnly && <div className="dc-duty-actions">
              <button className="dc-btn dc-btn-secondary" type="button" onClick={() => { setResult(null); setEditing(true); }}>更换账户</button>
              {!payroll?.attendance && <button className="dc-btn dc-btn-ghost is-danger" type="button" onClick={() => setUnbinding(true)}>解除绑定</button>}
            </div>}
          </>
        ) : (
          <form className="dc-stack" onSubmit={bind} noValidate aria-label="绑定工资账户">
            <p className="dc-top-sub">{account ? '' : '还没有绑定工资账户，工资暂不发放。'}输入要收工资的学生账户的学号{admin ? '' : '和登录密码'}。</p>
            <label className="dc-field">
              <span className="dc-field-label"><Icon name="me" />学号</span>
              <span className="dc-input-wrap"><input className="dc-input" inputMode="numeric" autoComplete="off" value={no} onChange={(e) => setNo(e.target.value)} /></span>
            </label>
            {!admin && (
              <label className="dc-field">
                <span className="dc-field-label"><Icon name="lock" />该学生账户的密码</span>
                <span className="dc-input-wrap"><input className="dc-input" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></span>
                <span className="dc-field-hint">连续输错 5 次，该学生账号会锁定 15 分钟</span>
              </label>
            )}
            <div className="dc-duty-actions">
              {account && <button className="dc-btn dc-btn-ghost" type="button" onClick={() => setEditing(false)}>取消</button>}
              <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="submit" disabled={busy || !no.trim() || (!admin && !password)}>绑定</button>
            </div>
          </form>
        )}
      </div>
      {unbinding && (
        <ConfirmSheet title="解除工资账户的绑定？" text="解除后工资暂不发放，直到绑定新的账户。" confirm="解除绑定"
          onClose={() => setUnbinding(false)} onConfirm={unbind} />
      )}
    </section>
  );
}
