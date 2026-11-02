import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CounterPage, DayShifts, formatDate, Icon, ListLoading, Notice, SalaryAccount, ShiftCalendar, ShiftMark, Stats, today } from '@/components';
import { earned, NO_RATES, SHIFT_STATUS, SHIFTS, usePayroll, useSalaryRate, useShifts, weekOf } from '@/lib/attendance';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatTime, shiftAt, shiftDay } from '@/lib/format';
import { useOnline } from '@/lib/online';
import { call } from '@/lib/rpc';
import { useMe } from '@/lib/session';

// 考勤 (PHASE-1.md §7.5): sign in for the shift of now, the month as a calendar of shifts, this week's and this
// month's 有效班次 and pay, and the student account the pay goes to.
export default function Attendance() {
  const me = useMe().data!;
  const online = useOnline();
  const queryClient = useQueryClient();
  const now = today();
  const shift = shiftAt(new Date());
  const [month, setMonth] = useState(now.slice(0, 7));
  const [picked, setPicked] = useState(now);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ title: string; text: string } | null>(null);
  const payroll = usePayroll();
  const rate = useSalaryRate();
  const mine = payroll.data?.find((p) => p.user_id === me.profile.id);
  const end = shiftDay(`${shiftDay(`${month}-01`, 31).slice(0, 7)}-01`, -1);
  const shifts = useShifts(`${month}-01`, end, me.profile.id);
  const [monday, sunday] = weekOf(now);
  const week = useShifts(monday, sunday, me.profile.id);
  const current = week.data?.find((r) => r.day === now && r.shift === shift);

  async function sign() {
    setBusy(true);
    setProblem(null);
    try {
      await call('sign_attendance', {});
      await queryClient.invalidateQueries({ queryKey: ['attendance'] });
    } catch (err) {
      setProblem(err instanceof AppError ? explain(err.code, err.detail) : explain(''));
    } finally {
      setBusy(false);
    }
  }

  const rows = shifts.data ?? [];
  const valid = (list = rows) => list.filter((r) => r.status === 'confirmed').length;
  const r = rate.data ?? NO_RATES;
  return (
    <CounterPage title="考勤">
      {problem && <Notice tone="danger" title={problem.title}>{problem.text}</Notice>}
      <div className="dc-split">
        <div className="dc-stack dc-enter">
          {payroll.data && !mine?.attendance ? (
            <Notice title="还没有参与考勤">由银行管理员设置后才能签到；以前的记录仍可在下面查看。</Notice>
          ) : (
            <div className="dc-card at-sign">
              <span className="at-sign-main">
                <b>{formatDate(now)} · {SHIFTS[shift]}</b>
                <small className="dc-top-sub">
                  {current ? `已签到 ${formatTime(current.signed_at)} · ${SHIFT_STATUS[current.status]}` : '13:30 之前为中午班，13:30 起为下午班'}
                </small>
              </span>
              {current ? <ShiftMark shift={shift} row={current} />
                : <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button" disabled={busy || !online || !payroll.data} onClick={sign}>
                    <Icon name="check" />签到
                  </button>}
            </div>
          )}
          <Stats items={[
            ['本周有效', valid(week.data ?? []), '个班次'],
            ['本月有效', valid(), '个班次'],
            ['本月待审', rows.filter((x) => x.status === 'pending').length, '个班次'],
            ['本月工资', formatAmount(earned(rows, r)), `HTB · 已发 ${formatAmount(rows.reduce((s, x) => s + (x.pay ?? 0), 0))}`],
          ]} />
          {shifts.error ? <Notice tone="danger" title="暂时无法读取考勤">请检查网络后刷新页面。</Notice>
            : <ShiftCalendar month={month} rows={rows} max={now} picked={picked} onPick={setPicked}
                onMonth={(m) => { setMonth(m); setPicked(m === now.slice(0, 7) ? now : `${m}-01`); }} />}
          <p className="dc-top-sub">每个班次由银行管理员确认后计为有效；工资中午班每个 {r.am} HTB、下午班每个 {r.pm} HTB，每周发放到工资账户。</p>
        </div>
        <div className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties}>
          {shifts.isPending ? <ListLoading rows={2} label="正在加载考勤" /> : <DayShifts day={picked} rows={rows} />}
          <SalaryAccount userId={me.profile.id} payroll={mine} />
        </div>
      </div>
    </CounterPage>
  );
}
