import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { bindSalaryAccount, SHIFT_STATUS, SHIFTS, type Payroll, type Shift, type ShiftRow } from '@/lib/attendance';
import { AppError, explain } from '@/lib/errors';
import { formatTime, shiftDay } from '@/lib/format';
import { call } from '@/lib/rpc';
import { Summary } from './Counter';
import { formatDate, today } from './DatePicker';
import { ConfirmSheet } from './Sheet';
import { Icon, Notice } from './ui';

const WEEK = '一二三四五六日';
const ORDER: Shift[] = ['am', 'pm'];
const failure = (e: unknown) => (e instanceof AppError ? explain(e.code, e.detail) : explain(''));

// A shift's state as a small mark: 上 / 下, coloured by its status, with the words for screen readers beside it.
export function ShiftMark({ shift, row }: { shift: Shift; row?: ShiftRow }) {
  return <i className={`at-mark is-${row?.status ?? 'none'}`}>{shift === 'am' ? '上' : '下'}</i>;
}
export const shiftWords = (shift: Shift, row?: ShiftRow) => `${SHIFTS[shift]}${row ? SHIFT_STATUS[row.status] : '未签到'}`;

export function ShiftLegend() {
  return (
    <p className="at-legend" aria-hidden="true">
      {(['confirmed', 'pending', 'rejected', 'none'] as const).map((s) => (
        <span key={s}><i className={`at-mark is-${s}`}>上</i>{s === 'none' ? '未签到' : SHIFT_STATUS[s]}</span>
      ))}
    </p>
  );
}

// 考勤日历: a month, Monday first, each day with its 上午班 and 下午班. Days after `max` cannot be picked.
export function ShiftCalendar({ month, onMonth, rows, max, picked, onPick }: {
  month: string; onMonth: (m: string) => void; rows: ShiftRow[]; max: string; picked: string; onPick: (day: string) => void;
}) {
  const of = new Map<string, Partial<Record<Shift, ShiftRow>>>();
  for (const r of rows) of.set(r.day, { ...of.get(r.day), [r.shift]: r });
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const days = Array.from({ length: new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, i) => shiftDay(first, i));
  const now = today();
  return (
    <div className="dc-card at-cal">
      <div className="dc-cal-head">
        <button className="dc-cal-nav" type="button" aria-label="上个月" onClick={() => onMonth(shiftDay(first, -1).slice(0, 7))}><Icon name="back" /></button>
        <h2 className="at-cal-title">{y}年{m}月</h2>
        <button className="dc-cal-nav" type="button" aria-label="下个月" disabled={month >= max.slice(0, 7)}
          onClick={() => onMonth(shiftDay(first, 31).slice(0, 7))}><Icon name="next" /></button>
      </div>
      <div className="dc-cal-grid">{[...WEEK].map((w) => <span key={w} className="dc-cal-week" aria-hidden="true">{w}</span>)}</div>
      <div className="dc-cal-grid" role="group" aria-label={`${y}年${m}月考勤`}>
        {Array.from({ length: (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7 }, (_, i) => <span key={i} />)}
        {days.map((d, i) => {
          const day = of.get(d) ?? {};
          return (
            <button key={d} className={`at-day${d === now ? ' is-today' : ''}`} type="button" aria-pressed={d === picked} disabled={d > max}
              aria-label={`${m}月${i + 1}日 星期${WEEK[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7]}：${ORDER.map((s) => shiftWords(s, day[s])).join('，')}`}
              onClick={() => onPick(d)}>
              <span>{i + 1}</span>
              <span className="at-marks" aria-hidden="true">{ORDER.map((s) => <ShiftMark key={s} shift={s} row={day[s]} />)}</span>
            </button>
          );
        })}
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
            <li key={s} className="at-shift">
              <ShiftMark shift={s} row={r} />
              <span className="at-shift-main">
                <b>{SHIFTS[s]} · {r ? SHIFT_STATUS[r.status] : '未签到'}</b>
                {r && (
                  <small className="dc-top-sub">
                    {makeup ? `${names?.get(r.signed_by) ?? '银行管理员'}补签 ${formatTime(r.signed_at)}` : `签到 ${formatTime(r.signed_at)}`}
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

// 工资账户: the student account a teller's pay goes to, bound with that account's password, by the teller or by the
// bank admin or sysadmin for them.
export function SalaryAccount({ userId, payroll }: { userId: string; payroll?: Payroll }) {
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
    if (busy || !no.trim() || !password) return;
    setBusy(true);
    try {
      const r = await bindSalaryAccount(userId, no.trim(), password);
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
        {account && !editing ? (
          <>
            <Summary rows={[...(payroll?.students ? [['学生', payroll.students.name] as [string, string]] : []), ['学号', account]]} />
            <div className="at-buttons">
              <button className="dc-btn dc-btn-secondary" type="button" onClick={() => { setResult(null); setEditing(true); }}>更换账户</button>
              <button className="dc-btn dc-btn-ghost is-danger" type="button" onClick={() => setUnbinding(true)}>解除绑定</button>
            </div>
          </>
        ) : (
          <form className="dc-stack" onSubmit={bind} noValidate aria-label="绑定工资账户">
            <p className="dc-top-sub">{account ? '' : '还没有绑定工资账户，工资暂不发放。'}输入要收工资的学生账户的学号和登录密码。</p>
            <label className="dc-field">
              <span className="dc-field-label"><Icon name="me" />学号</span>
              <span className="dc-input-wrap"><input className="dc-input" inputMode="numeric" autoComplete="off" value={no} onChange={(e) => setNo(e.target.value)} /></span>
            </label>
            <label className="dc-field">
              <span className="dc-field-label"><Icon name="lock" />该学生账户的密码</span>
              <span className="dc-input-wrap"><input className="dc-input" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></span>
              <span className="dc-field-hint">连续输错 5 次，该学生账号会锁定 15 分钟</span>
            </label>
            <div className="at-buttons">
              {account && <button className="dc-btn dc-btn-ghost" type="button" onClick={() => setEditing(false)}>取消</button>}
              <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="submit" disabled={busy || !no.trim() || !password}>绑定</button>
            </div>
          </form>
        )}
      </div>
      {unbinding && (
        <ConfirmSheet title="解除工资账户的绑定？" text="解除后工资暂不发放，直到绑定新的账户；已发放的工资不受影响。" confirm="解除绑定"
          onClose={() => setUnbinding(false)} onConfirm={unbind} />
      )}
    </section>
  );
}
