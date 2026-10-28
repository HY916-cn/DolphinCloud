import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { describeCash, type Counts } from '@/lib/cash';
import { classOf, deposit, lookupStudent, type Student } from '@/lib/counter';
import { AppError, explain } from '@/lib/errors';
import { formatAmount } from '@/lib/format';
import { cachedRoster, offlineQueue } from '@/lib/offline-queue';
import { useOnline } from '@/lib/online';
import { useMe } from '@/lib/session';
import { Page } from './Shell';
import { Icon, link, Notice } from './ui';

const css = (vars: Record<string, string | number>) => vars as React.CSSProperties;

// Steps: dots and names on wider screens, a thin progress bar with one line of text on phones.
export function Steps({ names, current }: { names: string[]; current: number }) {
  return (
    <>
      <ol className="dc-steps">
        {names.map((name, i) => (
          <li key={name} className={`dc-step ${i < current ? 'is-done' : i === current ? 'is-current' : ''}`}
            aria-current={i === current ? 'step' : undefined}>
            <span className="dc-step-dot">{i < current ? '✓' : i + 1}</span>{name}
          </li>
        ))}
      </ol>
      <p className="dc-steps-caption">第 {current + 1} 步，共 {names.length} 步：{names[current]}</p>
    </>
  );
}

// PersonCard: who is being served. Offline the balance is unknown and is not shown.
export function PersonCard({ student }: { student: Student }) {
  return (
    <div className="dc-person dc-enter">
      <span className="dc-person-avatar"><Icon name="me" /></span>
      <div className="dc-person-main">
        <div className="dc-person-name">{student.name}</div>
        <div className="dc-person-meta"><span>{classOf(student)}</span> · <span>学号 {student.student_no}</span></div>
      </div>
      {student.balance !== null && <div className="dc-person-side">{formatAmount(student.balance)}<small>当前余额 HTB</small></div>}
    </div>
  );
}

// QtyStepper: one card per face value, two columns, counts entered with − / + or typed.
export function CashCounter({ faces, counts, onChange }: { faces: number[]; counts: Counts; onChange: (c: Counts) => void }) {
  const set = (face: number, n: number) => onChange({ ...counts, [face]: Math.max(0, Math.min(999, n || 0)) });
  return (
    <div className="dc-denoms">
      {[...faces].sort((a, b) => a - b).map((face) => {
        const n = counts[face] ?? 0;
        return (
          <div key={face} className={`dc-qty ${n ? 'is-filled' : ''}`}>
            <div className="dc-qty-head">
              <span className="dc-qty-face">{face}<small>元</small></span>
              <span className="dc-qty-sum">小计<b>{formatAmount(face * n)}</b></span>
            </div>
            <div className="dc-qty-ctrl">
              <button className="dc-qty-btn" type="button" aria-label={`减少一张 ${face} 元`} disabled={!n} onClick={() => set(face, n - 1)}>
                <Icon name="minus" />
              </button>
              <input className="dc-qty-input" inputMode="numeric" aria-label={`${face} 元张数`} value={n}
                onFocus={(e) => e.target.select()} onChange={(e) => set(face, Number(e.target.value.replace(/\D/g, '')))} />
              <button className="dc-qty-btn" type="button" aria-label={`增加一张 ${face} 元`} onClick={() => set(face, n + 1)}>
                <Icon name="plus" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// SummaryList: name on the left, value on the right; the last row may be the total.
export function Summary({ rows, total }: { rows: [string, ReactNode][]; total?: [string, number] }) {
  return (
    <dl className="dc-kv">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      {total && <div className="is-total"><dt>{total[0]}</dt><dd>{formatAmount(total[1])}<small>HTB</small></dd></div>}
    </dl>
  );
}

// Result: the large outcome, the amounts, and the details of what was done; one action continues.
export function ResultView({ title, lead, rows, next = '办理下一位', onNext }: {
  title: string; lead: ReactNode; rows: [string, ReactNode][]; next?: string; onNext: () => void;
}) {
  return (
    <>
      <section className="dc-result">
        <span className="dc-result-badge dc-pop"><Icon name="success" /></span>
        <h1 className="display dc-enter" style={css({ '--i': 1 })}>{title}</h1>
        <p className="dc-result-lead dc-enter" style={css({ '--i': 2 })}>{lead}</p>
        <div className="dc-card dc-enter" style={css({ '--i': 3 })}><Summary rows={rows} /></div>
      </section>
      <div className="dc-actions">
        <button className="dc-btn dc-btn-primary" type="button" autoFocus onClick={onNext}>{next}</button>
      </div>
    </>
  );
}

// Step 1 of every business: type the student number and find the student. Offline (deposits only) the name
// and class come from the roster cached on this device, without a balance.
export function FindStudent({ onFound, offline }: { onFound: (s: Student) => void; offline?: boolean }) {
  const me = useMe().data!;
  const [no, setNo] = useState('');
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function find(e: FormEvent) {
    e.preventDefault();
    if (!no.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (offline) {
        const s = (await cachedRoster(me.profile.id)).find((r) => r.student_no === no.trim());
        if (!s) throw new AppError('STUDENT_NOT_FOUND');
        onFound({ ...s, division: 'primary', cohort: 0, balance: null, withdrawn_today: null });
      } else {
        onFound(await lookupStudent(no));
      }
    } catch (err) {
      const code = err instanceof AppError ? err.code : '';
      setError(explain(code, err instanceof AppError ? err.detail : {}));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="dc-form" onSubmit={find} noValidate>
      <label className={`dc-field ${error ? 'is-error' : ''}`}>
        <span className="dc-field-label"><Icon name="me" />学号</span>
        <span className="dc-input-wrap">
          <input className="dc-input" inputMode="numeric" autoComplete="off" autoFocus value={no} placeholder="请输入学号"
            onChange={(e) => setNo(e.target.value)} />
        </span>
        <span className="dc-field-hint">输入后核对姓名和班级{offline ? '（离线时不显示余额）' : ''}</span>
      </label>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <div className="dc-actions">
        <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="submit" disabled={!busy && !no.trim()}>
          {busy ? '正在查找' : '查找学生'}
        </button>
      </div>
    </form>
  );
}

// Every counter page: the title row with back (when a flow is under way) and the account switcher, the
// offline bar, and the offline deposits waiting to be uploaded.
export function CounterPage({ title, onBack, children }: { title: string; onBack?: () => void; children: ReactNode }) {
  const me = useMe().data!;
  const online = useOnline();
  return (
    <Page title={title} sub={me.profile.display_name} back={onBack} actions={
      <a className="dc-icon-btn" aria-label="切换账号" {...link('/accounts')}><Icon name="me" /></a>
    }>
      {!online && <Notice tone="danger" title="离线登记">网络已断开，现在只能登记存款，联网后上传。请同时填写纸质凭条。</Notice>}
      {online && <PendingUploads operatorId={me.profile.id} />}
      {children}
    </Page>
  );
}

function PendingUploads({ operatorId }: { operatorId: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const queue = useQuery({ queryKey: ['offline-deposits'], queryFn: offlineQueue.list });
  const all = queue.data ?? [];
  if (!all.length) return null;
  const mine = all.filter((e) => e.operator_id === operatorId);
  const waiting = mine.filter((e) => !e.error);
  const others = all.filter((e) => e.operator_id !== operatorId);

  async function upload() {
    setBusy(true);
    await offlineQueue.upload(operatorId, (e) => deposit(e.id, e.student_no, e.cash, true, e.created_at));
    setBusy(false);
    queryClient.invalidateQueries({ queryKey: ['offline-deposits'] });
  }

  return (
    <>
      {waiting.length > 0 && (
        <div className="dc-notice dc-notice-coin" role="status">
          <Icon name="inbox" />
          <div style={{ flex: 1 }}>
            <p className="dc-notice-title">有 {waiting.length} 笔离线存款待上传</p>
            <p className="dc-notice-text">共 {formatAmount(waiting.reduce((s, e) => s + e.amount, 0))} HTB，按登记时间顺序入账。</p>
          </div>
          <button className={`dc-btn dc-btn-primary dc-btn-sm ${busy ? 'is-loading' : ''}`} type="button" onClick={upload}>
            {busy ? '正在上传' : '上传'}
          </button>
        </div>
      )}
      {mine.filter((e) => e.error).map((e) => (
        <Notice key={e.id} tone="danger" title={`离线存款未能入账：${e.name} ${formatAmount(e.amount)} HTB`}>
          {explain(e.error!).title}。{describeCash(e.cash)}，{new Date(e.created_at).toLocaleString('zh-CN', { hour12: false })} 登记，请交指导老师核对纸质凭条。
        </Notice>
      ))}
      {others.length > 0 && (
        <Notice title={`本机另有 ${others.length} 笔离线存款`}>
          由 {[...new Set(others.map((e) => e.operator_name))].join('、')} 登记，需要该柜员登录后上传。
        </Notice>
      )}
    </>
  );
}

// What a business that needs the network shows while the counter is offline (the bar above says why).
export function NeedsNetwork({ business }: { business: string }) {
  return (
    <div className="dc-card">
      <div className="dc-empty">
        <span className="dc-empty-icon"><Icon name="warning" /></span>
        <h3>{business}需要联网</h3>
        <p>联网后再办理{business}；离线时可以继续登记存款。</p>
        <a className="dc-btn dc-btn-secondary dc-btn-sm" {...link('/counter/deposit')}>去登记存款</a>
      </div>
    </div>
  );
}
