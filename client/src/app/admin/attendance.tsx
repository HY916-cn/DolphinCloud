import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmSheet, DayShifts, Desk, Icon, link, ListLoading, Notice, ShiftLegend, ShiftMark, shiftWords, Stats, today } from '@/components';
import { earned, SHIFTS, usePayroll, useSalaryRate, useShifts, weekOf, type Shift, type ShiftRow } from '@/lib/attendance';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, shiftAt, shiftDay } from '@/lib/format';
import { call } from '@/lib/rpc';
import { useStaff } from '@/lib/staff';
import { supabase } from '@/lib/supabase';

const ORDER: Shift[] = ['am', 'pm'];
const WEEK = '一二三四五六日';
const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日`;
type Cell = { user: string; name: string; day: string; shift: Shift; row?: ShiftRow };
type Paid = { name: string; shifts: number; amount: number; account?: string; reason?: string };
type Result = { tone: 'success' | 'danger' | 'info'; title: string; text: string };
const failure = (e: unknown) => (e instanceof AppError ? explain(e.code, e.detail) : explain(''));

// 考勤 (bank admin, PHASE-1.md §7.9): a week of every counted teller's shifts; a shift opens to confirm or reject it,
// or to sign it in (补签). 「确认待审」 confirms the week's waiting shifts at once; 「发放工资」 pays every confirmed,
// unpaid shift up to the week's Sunday into each teller's bound account. Below, who is counted.
export default function AttendanceDesk() {
  const queryClient = useQueryClient();
  const now = today();
  const [monday, setMonday] = useState(weekOf(now)[0]);
  const sunday = shiftDay(monday, 6);
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(monday, i));
  const staff = useStaff();
  const payroll = usePayroll();
  const rate = useSalaryRate().data ?? 0;
  const shifts = useShifts(monday, sunday);
  const unpaid = useQuery({
    queryKey: ['attendance', 'unpaid', sunday],
    queryFn: async () => {
      const { data, error } = await supabase.from('attendance').select('user_id').eq('status', 'confirmed').is('salary_txn', null).lte('day', sunday);
      if (error) throw error;
      return data as { user_id: string }[];
    },
  });
  const [cell, setCell] = useState<Cell | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const tellers = (staff.data ?? []).filter((s) => s.role === 'teller');
  const names = new Map((staff.data ?? []).map((s) => [s.id, s.display_name]));
  const rows = shifts.data ?? [];
  const counted = (id: string) => payroll.data?.find((p) => p.user_id === id);
  const listed = tellers.filter((t) => counted(t.id)?.attendance || rows.some((r) => r.user_id === t.id));
  const pending = rows.filter((r) => r.status === 'pending');
  const toPay = tellers.flatMap((t) => {
    const n = (unpaid.data ?? []).filter((u) => u.user_id === t.id).length;
    return n ? [{ name: t.display_name, shifts: n, amount: n * rate, account: counted(t.id)?.account ?? undefined }] : [];
  });
  const later = (day: string, shift: Shift) => day > now || (day === now && shift === 'pm' && shiftAt(new Date()) === 'am');
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['attendance'] }), queryClient.invalidateQueries({ queryKey: ['payroll'] })]);

  async function run(fn: string, args: Record<string, unknown>, done: (r: never) => Result) {
    setBusy(true);
    try {
      setResult(done(await call<never>(fn, args)));
    } catch (err) {
      setResult({ tone: 'danger', ...failure(err) });
    } finally {
      setBusy(false);
      setCell(null);
      setConfirming(false);
      setPaying(false);
      await refresh();
    }
  }

  const pay = () => run('pay_salaries', { p_week: sunday }, (r: { paid: Paid[]; skipped: Paid[] }) => ({
    tone: r.paid.length ? 'success' : 'info',
    title: r.paid.length ? `已发放 ${formatAmount(r.paid.reduce((s, p) => s + p.amount, 0))} HTB` : '没有要发放的工资',
    text: [
      ...r.paid.map((p) => `${p.name} ${p.shifts} 个班次 ${formatAmount(p.amount)} HTB → 学号 ${p.account}`),
      ...r.skipped.map((p) => `${p.name} ${p.shifts} 个班次未发放：${p.reason === 'unbound' ? '还没有绑定工资账户' : '工资账户已冻结或已毕业'}`),
    ].join('；'),
  }));

  return (
    <Desk title="考勤">
      {result && <Notice tone={result.tone} title={result.title}>{result.text || undefined}</Notice>}
      <div className="dc-stack dc-enter">
        <div className="at-weekbar">
          <button className="dc-icon-btn" type="button" aria-label="上一周" onClick={() => setMonday(shiftDay(monday, -7))}><Icon name="back" /></button>
          <h2 className="at-cal-title">{md(monday)} – {md(sunday)}</h2>
          <button className="dc-icon-btn" type="button" aria-label="下一周" disabled={sunday >= now} onClick={() => setMonday(shiftDay(monday, 7))}><Icon name="next" /></button>
          {monday !== weekOf(now)[0] && <button className="dc-btn dc-btn-ghost dc-btn-sm" type="button" onClick={() => setMonday(weekOf(now)[0])}>本周</button>}
          <span style={{ flex: 1 }} />
          <button className="dc-btn dc-btn-secondary" type="button" disabled={!pending.length} onClick={() => setConfirming(true)}>确认待审（{pending.length}）</button>
          <button className="dc-btn dc-btn-primary" type="button" disabled={!toPay.length} onClick={() => setPaying(true)}><Icon name="coin" />发放工资</button>
        </div>
        <Stats items={[
          ['本周有效', rows.filter((r) => r.status === 'confirmed').length, '个班次'],
          ['待审', pending.length, '个班次'],
          ['本周工资', formatAmount(earned(rows, rate)), 'HTB'],
          ['每班次', rate, 'HTB'],
        ]} />
        {shifts.error || staff.error ? <Notice tone="danger" title="暂时无法读取考勤">请检查网络后刷新页面。</Notice>
          : shifts.isPending || staff.isPending ? <ListLoading rows={3} label="正在加载考勤" />
          : !listed.length ? <Notice title="还没有参与考勤的柜员">在下面「参与考勤」里打开柜员的开关。</Notice>
          : (
            <div className="dc-card">
              <div className="rp-scroll">
                <table className="rp-table at-week" aria-label="本周考勤">
                  <thead>
                    <tr>
                      <th scope="col">柜员</th>
                      {days.map((d, i) => <th key={d} scope="col" className={d === now ? 'is-today' : undefined}>周{WEEK[i]}<small>{md(d)}</small></th>)}
                      <th scope="col" className="n">有效</th><th scope="col" className="n">工资</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listed.map((t) => {
                      const mine = rows.filter((r) => r.user_id === t.id);
                      const account = counted(t.id)?.account;
                      return (
                        <tr key={t.id}>
                          <td><a {...link(`/admin/staff/${t.id}`)}>{t.display_name}</a><small className="dc-top-sub">{account ? `学号 ${account}` : '未绑定工资账户'}</small></td>
                          {days.map((d) => (
                            <td key={d}>
                              <span className="at-cell">
                                {ORDER.map((s) => {
                                  const row = mine.find((r) => r.day === d && r.shift === s);
                                  return (
                                    <button key={s} className="at-cell-btn" type="button" disabled={!row && later(d, s)}
                                      aria-label={`${t.display_name} ${md(d)} ${shiftWords(s, row)}`}
                                      onClick={() => { setResult(null); setCell({ user: t.id, name: t.display_name, day: d, shift: s, row }); }}>
                                      <ShiftMark shift={s} row={row} />
                                    </button>
                                  );
                                })}
                              </span>
                            </td>
                          ))}
                          <td className="n">{mine.filter((r) => r.status === 'confirmed').length}</td>
                          <td className="n">{formatAmount(earned(mine, rate))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ShiftLegend />
            </div>
          )}
        <Counted tellers={tellers} counted={counted} onError={setResult} onDone={refresh} />
      </div>

      {cell && <ShiftSheet cell={cell} names={names} busy={busy} onClose={() => setCell(null)} run={run} />}
      {confirming && (
        <ConfirmSheet title={`确认本周 ${pending.length} 个待审班次？`} text="确认后计为有效班次，计入工资。" confirm="全部确认" busy={busy}
          onClose={() => setConfirming(false)}
          onConfirm={() => run('review_attendance', { p_ids: pending.map((r) => r.id), p_status: 'confirmed' },
            (r: { count: number }) => ({ tone: 'success', title: `已确认 ${r.count} 个班次`, text: '' }))} />
      )}
      {paying && (
        <ConfirmSheet title={`发放截至 ${md(sunday)} 的工资？`} busy={busy} onClose={() => setPaying(false)} onConfirm={pay}
          confirm={`发放 ${formatAmount(toPay.filter((p) => p.account).reduce((s, p) => s + p.amount, 0))} HTB`}
          ready={toPay.some((p) => p.account)}
          text={`有效但还没发工资的班次，每个班次 ${rate} HTB，存入各自的工资账户；发放后不能撤回。`}>
          <ul className="dc-list" aria-label="本次发放">
            {toPay.map((p) => (
              <li key={p.name} className="at-shift">
                <span className="at-shift-main"><b>{p.name} · {p.shifts} 个班次 · {formatAmount(p.amount)} HTB</b>
                  <small className="dc-top-sub">{p.account ? `存入学号 ${p.account}` : '还没有绑定工资账户，本次不发放'}</small></span>
              </li>
            ))}
          </ul>
        </ConfirmSheet>
      )}
    </Desk>
  );
}

// One shift: confirm or reject it (until it is paid), or sign it in for the teller with a note.
function ShiftSheet({ cell, names, busy, onClose, run }: {
  cell: Cell; names: Map<string, string>; busy: boolean; onClose: () => void;
  run: (fn: string, args: Record<string, unknown>, done: (r: never) => Result) => void;
}) {
  const { row } = cell;
  const [status, setStatus] = useState<'confirmed' | 'rejected'>(row?.status === 'confirmed' ? 'rejected' : 'confirmed');
  const [note, setNote] = useState('');
  const title = `${cell.name} · ${md(cell.day)} ${SHIFTS[cell.shift]}`;
  if (row?.salary_txn) {
    return <ConfirmSheet title={title} text="这个班次的工资已发放，不能再修改。" confirm="知道了" onClose={onClose} onConfirm={onClose}>
      <DayShifts day={cell.day} rows={[row]} names={names} shifts={[cell.shift]} />
    </ConfirmSheet>;
  }
  if (!row) {
    return (
      <ConfirmSheet title={`补签：${title}`} text="补签的班次直接计为有效。" confirm="补签" busy={busy} ready={!!note.trim()} onClose={onClose}
        onConfirm={() => run('makeup_attendance', { p_user_id: cell.user, p_day: cell.day, p_shift: cell.shift, p_note: note.trim() },
          () => ({ tone: 'success', title: '已补签', text: title }))}>
        <label className="dc-field">
          <span className="dc-field-label"><Icon name="passbook" />补签说明</span>
          <span className="dc-input-wrap"><input className="dc-input" value={note} maxLength={60} placeholder="例如：忘记签到，已核实到岗" onChange={(e) => setNote(e.target.value)} /></span>
        </label>
      </ConfirmSheet>
    );
  }
  return (
    <ConfirmSheet title={title} text="确认后计为有效班次；未通过的班次不计工资。" confirm="保存" busy={busy} onClose={onClose}
      ready={status !== row.status}
      onConfirm={() => run('review_attendance', { p_ids: [row.id], p_status: status, p_note: note.trim() || null },
        () => ({ tone: 'success', title: status === 'confirmed' ? '已确认' : '已设为未通过', text: title }))}>
      <div className="dc-stack">
        <DayShifts day={cell.day} rows={[row]} names={names} shifts={[cell.shift]} />
        <div className="dc-chips" role="group" aria-label="审核结果">
          <button className="dc-chip" type="button" aria-pressed={status === 'confirmed'} onClick={() => setStatus('confirmed')}><Icon name="check" />有效</button>
          <button className="dc-chip" type="button" aria-pressed={status === 'rejected'} onClick={() => setStatus('rejected')}><Icon name="close" />未通过</button>
        </div>
        <label className="dc-field">
          <span className="dc-field-label"><Icon name="passbook" />说明（可不填）</span>
          <span className="dc-input-wrap"><input className="dc-input" value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} /></span>
        </label>
      </div>
    </ConfirmSheet>
  );
}

// 参与考勤: a switch per teller.
function Counted({ tellers, counted, onError, onDone }: {
  tellers: { id: string; display_name: string; login_id: string }[]; counted: (id: string) => { attendance: boolean } | undefined;
  onError: (r: Result) => void; onDone: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  async function set(id: string, on: boolean) {
    setBusy(id);
    try {
      await call('set_attendance', { p_user_id: id, p_on: on });
    } catch (err) {
      onError({ tone: 'danger', ...failure(err) });
    } finally {
      await onDone();
      setBusy(null);
    }
  }
  return (
    <section aria-label="参与考勤">
      <p className="dc-list-title">参与考勤</p>
      <ul className="dc-list">
        {tellers.map((t) => (
          <li key={t.id}>
            <label className="dc-switch">
              <span className="dc-switch-text"><b>{t.display_name}</b><small>账号 {t.login_id}</small></span>
              <input type="checkbox" role="switch" checked={!!counted(t.id)?.attendance} disabled={busy === t.id} onChange={(e) => set(t.id, e.target.checked)} />
              <span className="dc-switch-track" />
            </label>
          </li>
        ))}
      </ul>
      {!tellers.length && <p className="dc-top-sub">还没有柜员账号，在「人员」里新增。</p>}
    </section>
  );
}
