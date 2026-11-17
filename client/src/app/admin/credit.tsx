import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Avatar, ConfirmSheet, CreditFailed, CreditGauge, CreditGaugeLoading, CreditPausedNotice, Desk, Icon, link, ListLoading, Notice, Stepper, Toast,
  useCredit, useCreditEvents, useCreditPaused, useCreditSwitch, useGaugeCurve, type CreditEvent,
} from '@/components';
import { classOf } from '@/lib/counter';
import { RULES, switchToast, type CreditProfile, type CreditSwitchResult, type Curve, type Rules } from '@/lib/credit';
import { AppError, explain } from '@/lib/errors';
import { formatSigned, formatTime } from '@/lib/format';
import { useNewRows } from '@/lib/motion';
import { call } from '@/lib/rpc';
import { searchRoster } from '@/lib/search';
import { useMe } from '@/lib/session';
import { useStudents, type AdminStudent } from '@/lib/students';
import { supabase } from '@/lib/supabase';

const enter = (i: number) => ({ className: 'dc-stack dc-enter', style: { '--i': i } as React.CSSProperties });
const POINTS = { min: 1, max: 1000 };

// 信用分 (PHASE-2.md §8, design system data.md 信用分（后台）): find a student to see their score on the large gauge
// and every change of it; the bank admin adjusts it by hand. Above, the 信用分开关 (§8.5); below, the curve and the rules
// as they stand.
export default function Credit() {
  const me = useMe().data!;
  const admin = me.roles.includes('teacher');
  const students = useStudents();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<AdminStudent | null>(null);
  const found = useMemo(() => (text.trim() ? searchRoster(students.data?.index ?? [], text, 8) : []), [students.data, text]);
  const pick = (s: AdminStudent) => { setPicked(s); setText(''); };

  return (
    <Desk title="信用分">
      <CreditPausedNotice />
      <SwitchCard switches={admin} />
      <form className="dc-stack" role="search" aria-label="查找学生" onSubmit={(e) => { e.preventDefault(); if (found.length) pick(found[0]); }}>
        <label className="dc-search">
          <Icon name="query" />
          <input type="search" aria-label="搜索学生" placeholder="输入姓名、拼音、班级或学号" autoComplete="off" enterKeyHint="search"
            value={text} onChange={(e) => setText(e.target.value)} />
          {text && <button className="dc-search-clear" type="button" aria-label="清除" onClick={() => setText('')}><Icon name="close" /></button>}
        </label>
        {found.length > 0 && (
          <ul className="dc-list dc-filter-found" aria-label="搜索建议">
            {found.map((s) => (
              <li key={s.student_no}>
                <a className="dc-list-link" href="#" onClick={(e) => { e.preventDefault(); pick(s); }}>
                  <span className="dc-list-icon"><Icon name="me" /></span>
                  <span>{s.name}<small className="dc-top-sub">{classOf(s)} · 学号 {s.student_no}</small></span>
                  <Icon name="next" />
                </a>
              </li>
            ))}
          </ul>
        )}
        {text.trim() && students.data && !found.length && <p className="dc-top-sub">没有找到「{text.trim()}」。</p>}
        {students.isError && <Notice tone="danger" title="暂时无法读取学生名单">请检查网络后刷新页面。</Notice>}
      </form>

      {picked ? <StudentCredit key={picked.student_no} student={picked} admin={admin} /> : (
        <div className="dc-card dc-empty dc-enter">
          <span className="dc-empty-icon"><Icon name="gauge" /></span>
          <h3>选择一位学生</h3>
          <p>搜索姓名、班级或学号，查看这位学生的信用分和全部变动。</p>
        </div>
      )}

      <CurveCards edit={admin} />
    </Desk>
  );
}

// One student: the card and the large gauge (with 调整信用分 for the bank admin) beside every change, 30 at a time.
function StudentCredit({ student, admin }: { student: AdminStudent; admin: boolean }) {
  const queryClient = useQueryClient();
  const credit = useCredit(student.student_no);
  const curve = useGaugeCurve();
  const events = useCreditEvents(student.student_no, 30);
  const rows = events.data?.pages.flat();
  const fresh = useNewRows(rows?.map((e) => e.id));
  const [adjusting, setAdjusting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const paused = useCreditPaused();
  const c = credit.data;

  function adjusted(next: CreditProfile) {
    setAdjusting(false);
    setToast(`已调整为 ${next.score} 分`);
    queryClient.setQueryData(['credit', student.student_no], next);
    queryClient.invalidateQueries({ queryKey: ['credit-events', student.student_no] });
  }

  return (
    <div className="dc-split">
      <div {...enter(0)}>
        <div className="dc-person">
          <Avatar role="student" lg className="dc-person-avatar" />
          <div className="dc-person-main">
            <div className="dc-person-name">{student.name}</div>
            <div className="dc-person-meta"><span>{classOf(student)}</span> · <span>学号 {student.student_no}</span></div>
          </div>
        </div>
        {credit.isError ? <CreditFailed title="暂时无法读取信用分" onRetry={() => credit.refetch()} /> : (
          <section className="dc-card dc-stack" style={{ alignItems: 'center' }}>
            {c ? <CreditGauge score={c.score} size="lg" limit={c.loan_limit} next={c.points_to_next} {...curve} /> : <CreditGaugeLoading size="lg" />}
            {admin && c && <button className="dc-btn dc-btn-secondary" type="button" disabled={paused} aria-describedby={paused ? 'credit-paused' : undefined}
              onClick={() => setAdjusting(true)}>调整信用分</button>}
            {admin && c && paused && <p className="dc-caption" id="credit-paused">信用分暂停中</p>}
          </section>
        )}
      </div>
      <div {...enter(1)}>
        <p className="dc-list-title">全部变动</p>
        {events.isError && !rows ? <CreditFailed title="暂时无法读取变动记录" onRetry={() => events.refetch()} />
          : !rows ? <ListLoading rows={3} label="正在加载变动记录" />
          : !rows.length ? <div className="dc-card"><p className="dc-caption">还没有变动</p></div>
          : <EventTable rows={rows} fresh={fresh} />}
        {events.isError && rows && <CreditFailed title="暂时无法读取变动记录" onRetry={() => events.fetchNextPage()} />}
        {events.hasNextPage && (
          <button className={`dc-btn dc-btn-secondary dc-btn-block ${events.isFetchingNextPage ? 'is-loading' : ''}`} type="button"
            disabled={events.isFetchingNextPage} onClick={() => events.fetchNextPage()}>加载更多</button>
        )}
      </div>
      {adjusting && c && <AdjustSheets student={student} score={c.score} onClose={() => setAdjusting(false)} onDone={adjusted} />}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function EventTable({ rows, fresh }: { rows: CreditEvent[]; fresh: ReadonlySet<string> }) {
  return (
    <div className="dc-card dc-table-scroll">
      <table className="dc-table" aria-label="信用分变动">
        <thead><tr><th scope="col">时间</th><th scope="col" className="n">变动</th><th scope="col" className="n">变动后</th><th scope="col">原因</th></tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className={fresh.has(String(e.id)) ? 'is-new' : undefined}>
              <td>{formatTime(e.at)}</td>
              <td className="n">{formatSigned(e.delta)}</td>
              <td className="n">{e.score}</td>
              <td style={{ whiteSpace: 'normal' }}>{e.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 调整信用分: 加分 or 减分, the points and the reason with the score it comes to, then a second look; what the server
// refuses is said in the sheet.
function AdjustSheets({ student, score, onClose, onDone }: {
  student: AdminStudent; score: number; onClose: () => void; onDone: (c: CreditProfile) => void;
}) {
  const [gain, setGain] = useState(true);
  const [points, setPoints] = useState('5');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const n = Number(points);
  const ok = n >= POINTS.min && n <= POINTS.max && !!reason.trim();
  const to = Math.min(1000, Math.max(0, score + (gain ? n : -n)));
  const edge = score + (gain ? n : -n) > 1000 ? '（最高 1000 分）' : score + (gain ? n : -n) < 0 ? '（最低 0 分）' : '';

  async function adjust() {
    setBusy(true);
    setRefusal(null);
    try {
      const r = await call<{ credit: CreditProfile }>('adjust_credit', { p_student_no: student.student_no, p_delta: gain ? n : -n, p_reason: reason.trim() });
      onDone(r.credit);
    } catch (e) {
      const { code, detail } = e instanceof AppError ? e : new AppError('');
      setRefusal(code === 'INVALID_INPUT' && detail.field === 'delta' ? `${student.name}已经是 ${gain ? '1000 分，不能再加' : '0 分，不能再减'}`
        : code === 'ACCOUNT_CLOSED' ? '账号已注销' : explain(code, detail).title);
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <ConfirmSheet title={`给${student.name}${gain ? '加' : '减'} ${n} 分？`} text={`${score} 分 → ${to} 分。原因：${reason.trim()}。`}
        confirm="确认调整" busy={busy} onConfirm={adjust} onClose={() => { setConfirming(false); setRefusal(null); }}>
        {refusal && <div style={{ marginTop: 'var(--space-3)' }}><Notice tone="danger" title={refusal} /></div>}
      </ConfirmSheet>
    );
  }
  return (
    <ConfirmSheet title="调整信用分" confirm="下一步" ready={ok} onConfirm={() => setConfirming(true)} onClose={onClose}>
      <div className="dc-stack" style={{ marginTop: 'var(--space-3)' }}>
        <fieldset className="dc-seg" aria-label="加分或减分">
          {([[true, '加分'], [false, '减分']] as const).map(([g, label]) => (
            <label key={label}><input type="radio" name="credit-sign" checked={gain === g} onChange={() => setGain(g)} /><span>{label}</span></label>
          ))}
        </fieldset>
        <div className={`dc-field ${n >= POINTS.min && n <= POINTS.max ? '' : 'is-error'}`}>
          <div className="dc-qty is-product">
            <div className="dc-qty-head"><span className="dc-qty-name">分值</span></div>
            <Stepper label="分值" value={points} onChange={(v) => setPoints(v.slice(0, 4))} step={5} range={POINTS} />
          </div>
          {!(n >= POINTS.min && n <= POINTS.max) && <span className="dc-field-hint"><Icon name="warning" />请输入 1 到 1000 的整数</span>}
        </div>
        <label className="dc-field">
          <span className="dc-field-label"><Icon name="help" />原因</span>
          <span className="dc-input-wrap dc-input-area">
            <textarea className="dc-input" rows={3} maxLength={100} value={reason} placeholder="写清楚调整的原因" onChange={(e) => setReason(e.target.value)} />
          </span>
          <span className="dc-field-hint">必填，最多 100 字</span>
        </label>
        <p className="dc-sheet-text" aria-live="polite">{score} 分 → {to} 分{edge}</p>
      </div>
    </ConfirmSheet>
  );
}

// 信用分开关: how it stands and, for the bank admin only (not the president), the Switch 启用信用分. Pausing asks the
// reason and then a second look; turning back on asks only the second look. Scores change everywhere, so every query
// is read again.
function SwitchCard({ switches }: { switches: boolean }) {
  const queryClient = useQueryClient();
  const state = useCreditSwitch();
  const sw = state.data;
  const by = useQuery({
    queryKey: ['profile-name', sw?.updated_by],
    enabled: !!sw?.updated_by && !sw.value,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('display_name').eq('id', sw!.updated_by!).maybeSingle();
      if (error) throw error;
      return data?.display_name as string | undefined;
    },
  });
  const [turning, setTurning] = useState<boolean | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  if (state.isError) return <Notice tone="danger" title="暂时无法读取信用分开关">请检查网络后刷新页面。</Notice>;
  if (!sw) return <ListLoading rows={1} label="正在读取信用分开关" />;
  const status = sw.value ? '信用分已启用'
    : `信用分已暂停 · ${formatTime(sw.updated_at).split(' ')[0]}${by.data ? ` 由 ${by.data}` : ''} 暂停`;

  function done(r: CreditSwitchResult) {
    setTurning(null);
    setToast(switchToast(r));
    queryClient.invalidateQueries();
  }

  return (
    <section className="dc-card dc-enter">
      {switches ? (
        <label className="dc-switch">
          <span className="dc-switch-text"><b>启用信用分</b><small>{status}</small></span>
          <input type="checkbox" role="switch" checked={sw.value} onChange={(e) => setTurning(e.target.checked)} />
          <span className="dc-switch-track" />
        </label>
      ) : (
        <div className="dc-switch-text"><b>{status}</b><small>由银行管理员统一设置</small></div>
      )}
      {turning !== null && <SwitchSheets on={turning} onClose={() => setTurning(null)} onDone={done} />}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </section>
  );
}

function SwitchSheets({ on, onClose, onDone }: { on: boolean; onClose: () => void; onDone: (r: CreditSwitchResult) => void }) {
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(on);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function turn() {
    setBusy(true);
    setRefusal(null);
    try {
      onDone(await call<CreditSwitchResult>('set_credit_enabled', { p_on: on, p_reason: on ? null : reason.trim() }));
    } catch (e) {
      const { code, detail } = e instanceof AppError ? e : new AppError('');
      setRefusal(explain(code, detail).title);
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <ConfirmSheet title={on ? '重新开启信用分？' : '暂停信用分？'} confirm={on ? '确认开启' : '确认暂停'} busy={busy} onConfirm={turn}
        text={on ? '恢复每位学生暂停前的分数，之后照常加减分。暂停期间没有加减的分不补。'
          : '暂停后所有学生按 600 分计算额度和利率，分数不再加减。重新开启后恢复每位学生暂停前的分数。'}
        onClose={on ? onClose : () => { setConfirming(false); setRefusal(null); }}>
        {refusal && <div style={{ marginTop: 'var(--space-3)' }}><Notice tone="danger" title={refusal} /></div>}
      </ConfirmSheet>
    );
  }
  return (
    <ConfirmSheet title="暂停信用分" confirm="下一步" ready={!!reason.trim()} onConfirm={() => setConfirming(true)} onClose={onClose}>
      <label className="dc-field" style={{ marginTop: 'var(--space-3)' }}>
        <span className="dc-field-label"><Icon name="help" />原因</span>
        <span className="dc-input-wrap dc-input-area">
          <textarea className="dc-input" rows={3} maxLength={100} value={reason} placeholder="写清楚暂停的原因" onChange={(e) => setReason(e.target.value)} />
        </span>
        <span className="dc-field-hint">必填，最多 100 字</span>
      </label>
    </ConfirmSheet>
  );
}

// The curve and the rules as they stand, read only; the bank admin changes them on 参数.
function CurveCards({ edit }: { edit: boolean }) {
  const settings = useQuery({
    queryKey: ['settings', 'credit'],
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('key,value').in('key', ['credit_curve', 'credit_rules']);
      if (error) throw error;
      const v = Object.fromEntries(data.map((r) => [r.key, r.value]));
      return { curve: v.credit_curve as Curve, rules: v.credit_rules as Rules };
    },
  });
  const more = edit && <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link('/admin/settings')}>在参数页修改</a>;
  if (settings.isError) return <Notice tone="danger" title="暂时无法读取信用分参数">请检查网络后刷新页面。</Notice>;
  const s = settings.data;
  return (
    <div className="dc-split">
      <section className="dc-card dc-stack dc-enter" style={{ '--i': 2 } as React.CSSProperties}>
        <div className="dc-section-head"><h2 className="heading">计算参数</h2>{more}</div>
        {!s ? <ListLoading rows={3} label="正在加载参数" /> : (
          <dl className="dc-kv">
            <div><dt>能贷款的最低分</dt><dd>{s.curve.min_score} 分</dd></div>
            <div><dt>{s.curve.min_score} 分时的额度</dt><dd>{s.curve.limit_min} HTB</dd></div>
            <div><dt>1000 分时的额度</dt><dd>{s.curve.limit_max} HTB</dd></div>
            <div><dt>取整</dt><dd>{s.curve.limit_step} HTB</dd></div>
            <div><dt>贷款系数</dt><dd>×{s.curve.loan_max} → ×{s.curve.loan_min}</dd></div>
            <div><dt>储蓄系数</dt><dd>×{s.curve.saving_min} → ×{s.curve.saving_max}</dd></div>
          </dl>
        )}
      </section>
      <section className="dc-card dc-stack dc-enter" style={{ '--i': 3 } as React.CSSProperties}>
        <div className="dc-section-head"><h2 className="heading">加减分规则</h2>{more}</div>
        {!s ? <ListLoading rows={3} label="正在加载参数" /> : (
          <div className="dc-table-scroll">
            <table className="dc-table" aria-label="加减分规则">
              <thead><tr><th scope="col">事件</th><th scope="col" className="n">分值</th><th scope="col">何时记</th></tr></thead>
              <tbody>
                {RULES.map((r) => (
                  <tr key={r.key}>
                    <td style={{ whiteSpace: 'normal' }}>{r.event}</td>
                    <td className="n">{s.rules[r.key] ? formatSigned(s.rules[r.key]) : '0'}</td>
                    <td style={{ whiteSpace: 'normal' }}>{r.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
