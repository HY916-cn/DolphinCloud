import { useState } from 'react';
import { CounterPage, DutyCard, ListLoading, Notice, SalaryAccount, Stats, today, WeekBar, WeekShifts } from '@/components';
import { earned, usePayroll, useSalaryRate, useShifts, weekOf } from '@/lib/attendance';
import { useDuties } from '@/lib/duty';
import { formatAmount, formatTime, shiftDay } from '@/lib/format';
import { useMe } from '@/lib/session';

// 考勤 (PHASE-1.md §7.5): 上班 and 下班, a week of shifts (any week by its arrows or a day from the calendar), the
// week's 有效班次 and pay, its 上下班记录, and the student account the pay goes to.
export default function Attendance() {
  const me = useMe().data!;
  const [monday, setMonday] = useState(weekOf(today())[0]);
  const sunday = shiftDay(monday, 6);
  const payroll = usePayroll();
  const rate = useSalaryRate();
  const mine = payroll.data?.find((p) => p.user_id === me.profile.id);
  const shifts = useShifts(monday, sunday, me.profile.id);
  const duties = useDuties(me.profile.id, monday, sunday);
  const rows = shifts.data ?? [];
  const r = rate.data;
  return (
    <CounterPage title="考勤">
      <div className="dc-split">
        <div className="dc-stack dc-enter">
          <DutyCard me={me} />
          {payroll.data && !mine?.attendance && (
            <Notice title="还没有参与考勤">先绑定工资账户，再请银行管理员开启。</Notice>
          )}
          <WeekBar monday={monday} onMonday={setMonday} />
          <Stats items={[
            ['有效', rows.filter((x) => x.status === 'confirmed').length, '个班次'],
            ['待审', rows.filter((x) => x.status === 'pending').length, '个班次'],
            ['工资', r ? formatAmount(earned(rows, r)) : '—', 'HTB'],
            ['已发', formatAmount(rows.reduce((s, x) => s + (x.pay ?? 0), 0)), 'HTB'],
          ]} />
          {shifts.error ? <Notice tone="danger" title="暂时无法读取考勤">请检查网络后刷新页面。</Notice>
            : shifts.isPending ? <ListLoading rows={3} label="正在加载考勤" /> : <WeekShifts monday={monday} rows={rows} />}
          <p className="dc-top-sub">工资：中午班每个 {r?.am ?? '—'} HTB，下午班每个 {r?.pm ?? '—'} HTB。</p>
        </div>
        <div className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties}>
          <section aria-label="上下班记录">
            <p className="dc-list-title">上下班记录</p>
            {duties.data?.length ? (
              <ul className="dc-list">
                {duties.data.map((d) => (
                  <li key={d.id} className="dc-shift-row">
                    <span className="dc-shift-main">
                      <b>{formatTime(d.started_at)} 上班</b>
                      <small className="dc-top-sub">{d.ended_at ? `${formatTime(d.ended_at).split(' ')[1]} 下班 · 总结 ${d.txns} 笔业务` : '上班中'}</small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="dc-top-sub">{duties.isPending ? '正在加载…' : '这一周没有上班记录。'}</p>}
          </section>
          <SalaryAccount userId={me.profile.id} payroll={mine} />
        </div>
      </div>
    </CounterPage>
  );
}
