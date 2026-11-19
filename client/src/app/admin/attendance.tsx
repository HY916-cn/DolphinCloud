import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ConfirmSheet, DayShifts, Desk, Icon, link, ListLoading, Notice, ShiftLegend, ShiftMark, shiftWords, today, Toast, WeekBar,
} from '@/components';
import { SHIFTS, usePayroll, useSalaryRates, useShifts, weekOf, type Shift, type ShiftRow } from '@/lib/attendance';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, shiftAt, shiftDay } from '@/lib/format';
import { call } from '@/lib/rpc';
import { earned, maySign, PAID_ROLES, tally, type PaidRole } from '@/lib/salary';
import { ROLES, useMe } from '@/lib/session';
import { useStaff, type StaffLogin } from '@/lib/staff';
import { supabase } from '@/lib/supabase';

const ORDER: Shift[] = ['am', 'pm'];
const WEEK = '一二三四五六日';
const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日`;
type Person = StaffLogin & { role: PaidRole };
type Cell = { user: string; name: string; day: string; shift: Shift; row?: ShiftRow };
type Paid = { name: string; shifts: number; amount: number; account?: string; reason?: string };
type Result = { tone: 'success' | 'danger' | 'info'; title: string; text: string };
// Every refusal here is about attendance and pay, which the error texts are told (`payroll`); `sign` for 签到.
const failure = (e: unknown, sign = false) => (e instanceof AppError ? explain(e.code, { ...e.detail, payroll: true, sign }) : explain(''));
const SKIPPED: Record<string, string> = { unbound: '还没有绑定工资账户', inactive: '工资账户已冻结或已毕业', disabled: '账号已停用' };
const shiftCount = (t: { am: number; pm: number }) =>
  [t.am && `中午班 ${t.am} 个`, t.pm && `下午班 ${t.pm} 个`].filter(Boolean).join('、');
// A shift that has not begun yet: any day after today, and today's 下午班 before 13:30.
const later = (day: string, shift: Shift) => day > today() || (day === today() && shift === 'pm' && shiftAt(new Date()) === 'am');

// 考勤 (president, bank admin; PHASE-2.md §16.2, design system Attendance 全员考勤): one table of every counted person's
// week of shifts, grouped by identity and totalled, any week by its arrows or a day from the calendar. An empty cell of a shift begun is
// signed in from here (签到, confirmed at once) and a confirmed one not yet paid voided (作废) with a reason, by whoever
// may: nobody in their own row, a president's only by the bank admin. A waiting shift (上班, or 签到 on 我的) is the bank
// admin's to review, once and confirmed again; so are 「全部确认」, which confirms the week's waiting shifts at once, and
// 「发放工资」, which pays every confirmed, unpaid shift up to the week's Sunday at the 工资标准 of the identity it was
// signed under, once none up to then is waiting. 参与考勤 is switched on the person's page. Stopped logins are left out.
export default function AttendanceDesk() {
  const queryClient = useQueryClient();
  const me = useMe().data!;
  const mine = me.roles[0];
  const admin = mine === 'teacher';
  const now = today();
  const [monday, setMonday] = useState(weekOf(now)[0]);
  const sunday = shiftDay(monday, 6);
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(monday, i));
  const staff = useStaff();
  const payroll = usePayroll();
  const rate = useSalaryRates();
  const rates = rate.data ?? undefined;
  const shifts = useShifts(monday, sunday);
  const due = useQuery({
    queryKey: ['attendance', 'due', sunday],
    queryFn: async () => {
      const { data, error } = await supabase.from('attendance').select('user_id,shift,status,role').in('status', ['confirmed', 'pending'])
        .is('salary_txn', null).lte('day', sunday);
      if (error) throw error;
      return data as { user_id: string; shift: Shift; status: 'confirmed' | 'pending'; role: PaidRole }[];
    },
  });
  const [cell, setCell] = useState<Cell | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const people = (staff.data ?? []).filter((s): s is Person => !s.disabled && PAID_ROLES.includes(s.role as PaidRole));
  const names = new Map((staff.data ?? []).map((s) => [s.id, s.display_name]));
  const rows = (shifts.data ?? []).filter((r) => people.some((t) => t.id === r.user_id));
  const counted = (id: string) => payroll.data?.find((p) => p.user_id === id);
  const listed = people.filter((t) => counted(t.id)?.attendance || rows.some((r) => r.user_id === t.id));
  const pending = rows.filter((r) => r.status === 'pending');
  const unpaid = (due.data ?? []).filter((u) => people.some((t) => t.id === u.user_id));
  const waiting = unpaid.filter((u) => u.status === 'pending').length;
  // Known only once the rates are read: an amount to confirm is never made up from a rate still unknown.
  const toPay = !rates ? [] : people.flatMap((t) => {
    const t2 = tally(unpaid.filter((u) => u.user_id === t.id), rates);
    return t2.am + t2.pm ? [{ name: t.display_name, role: t.role, ...t2, account: counted(t.id)?.account ?? undefined }] : [];
  });
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
      ...r.skipped.filter((p) => p.reason !== 'disabled').map((p) => `${p.name} ${p.shifts} 个班次未发放：${SKIPPED[p.reason!]}`),
    ].join('；'),
  }));

  // One cell: an empty one of a shift begun is signed in, given a 工资账户, and a confirmed one not yet paid voided,
  // by whoever may sign that row; a waiting one is the bank admin's to review; the rest is only shown.
  const mark = (t: Person, d: string, s: Shift) => {
    const row = rows.find((r) => r.user_id === t.id && r.day === d && r.shift === s);
    const signs = maySign(mine, t.role, t.id === me.profile.id);
    const editable = !row ? signs && !!counted(t.id)?.account && !later(d, s)
      : row.status === 'pending' ? admin : signs && row.status === 'confirmed' && !row.salary_txn;
    const open = editable && !row;
    const label = `${t.display_name} ${md(d)} ${open ? `${SHIFTS[s]}，可签到` : shiftWords(s, row)}${row?.note ? ` · ${row.note}` : ''}`;
    return editable ? (
      <button key={s} className="dc-week-btn" type="button" aria-label={label}
        onClick={() => { setResult(null); setCell({ user: t.id, name: t.display_name, day: d, shift: s, row }); }}>
        <ShiftMark shift={s} row={row} open={open} />
      </button>
    ) : (
      <span key={s} className="dc-week-btn" role="img" aria-label={label}><ShiftMark shift={s} row={row} /></span>
    );
  };

  return (
    <Desk title="考勤">
      {result && <Notice tone={result.tone} title={result.title}>{result.text || undefined}</Notice>}
      {rate.isError && !rates && (
        <Notice tone="danger" title="暂时无法读取工资标准">
          读到工资标准后才能发放工资，请检查网络后重试。
          <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={() => rate.refetch()}>重试</button>
        </Notice>
      )}
      <div className="dc-stack dc-enter">
        <WeekBar monday={monday} onMonday={setMonday} />
        {admin && waiting > 0 && toPay.length > 0 && <p className="dc-caption">截至 {md(sunday)} 还有 {waiting} 个待审班次，全部审查后才能发放工资。</p>}
        {shifts.error || staff.error ? <Notice tone="danger" title="暂时无法读取考勤">请检查网络后刷新页面。</Notice>
          : shifts.isPending || staff.isPending ? <ListLoading rows={3} label="正在加载考勤" />
          : !listed.length ? <Notice title="还没有参与考勤的人员">{admin ? '在「人员」里打开「参与考勤」。' : '由银行管理员在「人员」里打开。'}</Notice>
          : (
            <div className="dc-card">
              <div className="dc-table-scroll">
                <table className="dc-table dc-week" aria-label="本周考勤">
                  <thead>
                    <tr>
                      <th scope="col">姓名</th>
                      {days.map((d, i) => <th key={d} scope="col" className={d === now ? 'is-today' : undefined}>周{WEEK[i]}<small>{md(d)}</small></th>)}
                      <th scope="col" className="n">有效</th><th scope="col" className="n">工资</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PAID_ROLES.filter((role) => listed.some((t) => t.role === role)).flatMap((role) => [
                      <tr key={role} className="is-group"><th scope="rowgroup" colSpan={10}>{ROLES[role]}</th></tr>,
                      ...listed.filter((t) => t.role === role).map((t) => {
                        const theirs = rows.filter((r) => r.user_id === t.id);
                        return (
                          <tr key={t.id}>
                            <td>{admin ? <a {...link(`/admin/staff/${t.id}`)}>{t.display_name}</a> : t.display_name}{!counted(t.id)?.account && <small>未绑定工资账户</small>}</td>
                            {days.map((d) => <td key={d}><span className="dc-week-marks">{ORDER.map((s) => mark(t, d, s))}</span></td>)}
                            <td className="n">{theirs.filter((r) => r.status === 'confirmed').length}</td>
                            <td className="n">{rates ? formatAmount(earned(theirs, rates)) : '—'}</td>
                          </tr>
                        );
                      }),
                    ])}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>合计</td><td colSpan={7} />
                      <td className="n">{rows.filter((r) => r.status === 'confirmed').length}</td>
                      <td className="n">{rates ? formatAmount(earned(rows, rates)) : '—'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <ShiftLegend open />
            </div>
          )}
      </div>
      {admin && (
        <div className="dc-actions is-row">
          <button className="dc-btn dc-btn-secondary" type="button" disabled={!pending.length} onClick={() => setConfirming(true)}>全部确认 {pending.length}</button>
          <button className="dc-btn dc-btn-primary" type="button" disabled={!toPay.length || waiting > 0} onClick={() => setPaying(true)}><Icon name="coin" />发放工资</button>
        </div>
      )}

      {cell && (!cell.row
        ? <SignSheet cell={cell} onClose={() => setCell(null)} onDone={async () => { setCell(null); setToast('已签到'); await refresh(); }} />
        : cell.row.status === 'pending'
        ? <ShiftSheet cell={cell as Cell & { row: ShiftRow }} names={names} busy={busy} onClose={() => setCell(null)} run={run} />
        : <VoidSheet cell={cell as Cell & { row: ShiftRow }} onClose={() => setCell(null)} onDone={async () => { setCell(null); setToast('已作废'); await refresh(); }} />)}
      {confirming && (
        <ConfirmSheet title={`全部确认本周 ${pending.length} 个待审班次？`} text="确认后计为有效班次、计入工资，之后不能再更改。" confirm="全部确认" busy={busy}
          onClose={() => setConfirming(false)}
          onConfirm={() => run('review_attendance', { p_ids: pending.map((r) => r.id), p_status: 'confirmed' },
            (r: { count: number }) => ({ tone: 'success', title: `已确认 ${r.count} 个班次`, text: '' }))} />
      )}
      {paying && rates && (
        <PaySheet sunday={sunday} toPay={toPay} busy={busy} onClose={() => setPaying(false)} onConfirm={pay} />
      )}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </Desk>
  );
}

// 发放工资: each person's unpaid confirmed shifts, counted by kind and paid at the 工资标准 of the identity each was
// signed under, into their 工资账户; one with none bound is listed and left out.
function PaySheet({ sunday, toPay, busy, onClose, onConfirm }: {
  sunday: string; toPay: { name: string; role: PaidRole; am: number; pm: number; amount: number; account?: string }[];
  busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <ConfirmSheet title={`发放截至 ${md(sunday)} 的工资？`} busy={busy} onClose={onClose} onConfirm={onConfirm}
      confirm={`发放 ${formatAmount(toPay.filter((p) => p.account).reduce((s, p) => s + p.amount, 0))} HTB`}
      ready={toPay.some((p) => p.account)}
      text="有效但还没发工资的班次，每个按记下的身份和班次取工资标准，存入各自的工资账户；发放后不能撤回。">
      <ul className="dc-list" aria-label="本次发放">
        {toPay.map((p) => (
          <li key={p.name} className="dc-shift-row">
            <span className="dc-shift-main"><b>{p.name} · {ROLES[p.role]} · {formatAmount(p.amount)} HTB</b>
              <small className="dc-top-sub">{shiftCount(p)} · {p.account ? `存入学号 ${p.account}` : '还没有绑定工资账户，本次不发放'}</small></span>
          </li>
        ))}
      </ul>
    </ConfirmSheet>
  );
}

// 签到 from the table: one empty cell of a shift begun, with a note; confirmed at once, it counts for pay.
function SignSheet({ cell, onClose, onDone }: { cell: Cell; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  async function sign() {
    setBusy(true);
    setError(null);
    try {
      await call('makeup_attendance', { p_user_id: cell.user, p_day: cell.day, p_shift: cell.shift, p_note: note.trim() });
      onDone();
    } catch (err) {
      setError(failure(err, true));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConfirmSheet title={`给${cell.name}签到？`} text={`${md(cell.day)} ${SHIFTS[cell.shift]}，签上即有效，计入工资。`} confirm="签到"
      busy={busy} ready={!!note.trim()} onClose={onClose} onConfirm={sign}>
      <div className="dc-stack">
        {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
        <label className="dc-field">
          <span className="dc-field-label"><Icon name="help" />说明</span>
          <span className="dc-input-wrap dc-input-area">
            <textarea className="dc-input" rows={2} maxLength={100} value={note} placeholder="例如：值周检查、补记柜台班次" onChange={(e) => setNote(e.target.value)} />
          </span>
          <span className="dc-field-hint">必填，最多 100 字</span>
        </label>
      </div>
    </ConfirmSheet>
  );
}

// 作废: a confirmed shift, not yet paid, with the reason; it then pays nothing and cannot be restored.
function VoidSheet({ cell, onClose, onDone }: { cell: Cell & { row: ShiftRow }; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await call('void_attendance', { p_id: cell.row.id, p_note: note.trim() });
      onDone();
    } catch (err) {
      setError(failure(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConfirmSheet title={`作废${cell.name} ${md(cell.day)}的${SHIFTS[cell.shift]}？`} text="作废后这个班次不计工资，不能恢复。" confirm="作废"
      busy={busy} ready={!!note.trim()} onClose={onClose} onConfirm={cancel}>
      <div className="dc-stack">
        {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
        {cell.row.note && <p className="dc-top-sub">说明：{cell.row.note}</p>}
        <label className="dc-field">
          <span className="dc-field-label"><Icon name="passbook" />作废原因</span>
          <span className="dc-input-wrap"><input className="dc-input" value={note} maxLength={100} placeholder="例如：签错了日期" onChange={(e) => setNote(e.target.value)} /></span>
        </label>
      </div>
    </ConfirmSheet>
  );
}

// A waiting shift (the bank admin's): 有效 or 未通过 with a note, then confirmed once more, since the decision stands.
function ShiftSheet({ cell, names, busy, onClose, run }: {
  cell: Cell & { row: ShiftRow }; names: Map<string, string>; busy: boolean; onClose: () => void;
  run: (fn: string, args: Record<string, unknown>, done: (r: never) => Result) => void;
}) {
  const { row } = cell;
  const [status, setStatus] = useState<'confirmed' | 'rejected' | null>(null);
  const [sure, setSure] = useState(false);
  const [note, setNote] = useState('');
  const title = `${cell.name} · ${md(cell.day)} ${SHIFTS[cell.shift]}`;
  if (sure && status) {
    return (
      <ConfirmSheet title={`确认把这个班次设为${status === 'confirmed' ? '有效' : '未通过'}？`} busy={busy} onClose={onClose}
        text={`${title}${note.trim() ? `（${note.trim()}）` : ''}。审查后不能再更改。`} confirm={status === 'confirmed' ? '确认有效' : '确认未通过'}
        onConfirm={() => run('review_attendance', { p_ids: [row.id], p_status: status, p_note: note.trim() || null },
          () => ({ tone: 'success', title: status === 'confirmed' ? '已确认' : '已设为未通过', text: title }))} />
    );
  }
  return (
    <ConfirmSheet title={`审查：${title}`} text="有效的班次计入工资；未通过的不计。审查后不能再更改。" confirm="下一步" ready={!!status}
      onClose={onClose} onConfirm={() => setSure(true)}>
      <div className="dc-stack">
        <DayShifts day={cell.day} rows={[row]} names={names} shifts={[cell.shift]} />
        <div className="dc-chips" role="group" aria-label="审查结果">
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
