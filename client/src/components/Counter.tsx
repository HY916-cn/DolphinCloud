import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { describeCash, diffNotes, type Counts } from '@/lib/cash';
import { classOf, deposit, lookupStudent, useRoster, type Student } from '@/lib/counter';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatNet, formatTime } from '@/lib/format';
import { offlineQueue, retryDelay, type OfflineDeposit, type RosterEntry } from '@/lib/offline-queue';
import { useOnline } from '@/lib/online';
import { searchRoster } from '@/lib/search';
import { useBump } from '@/lib/motion';
import { useMe } from '@/lib/session';
import { ConfirmSheet } from './Sheet';
import { Page } from './Shell';
import { ListLoading } from './Skeleton';
import { Avatar } from './Avatar';
import type { Range } from './Stepper';
import { Icon, link, Notice } from './ui';

// QtyStepper's 小计, whose number bumps when it changes.
export function QtySum({ amount }: { amount: number }) {
  const ref = useBump<HTMLElement>(amount);
  return <span className="dc-qty-sum">小计<b ref={ref}>{formatNet(amount)}</b></span>;
}

// QtyStepper: one card per face value, two columns, counts entered with − / + or typed. `sum` replaces the 小计 (轧账
// writes 应有 there), `diff` adds each face's 核对 result under its control, and `what` names the count for screen readers.
// `range` bounds each count (0–999 at the counter); below 0 (登记货币's 更正) a count may be typed with its minus.
export function CashCounter({ faces, counts, onChange, kind, sum, diff, what = '张数', range = { min: 0, max: 999 } }: {
  faces: number[]; counts: Counts; onChange: (c: Counts) => void; kind: string; sum?: (face: number) => ReactNode; diff?: Counts | null; what?: string;
  range?: Range;
}) {
  const set = (face: number, n: number) => onChange({ ...counts, [face]: Math.max(range.min, Math.min(range.max, n || 0)) });
  const typed = (v: string) => (range.min < 0 && /^[-−]/.test(v) ? -1 : 1) * Number(v.replace(/\D/g, ''));
  return (
    <div className={`dc-denoms ${kind}`}>
      {[...faces].sort((a, b) => a - b).map((face) => {
        const n = counts[face] ?? 0;
        const off = diff?.[face];
        return (
          <div key={face} className={`dc-qty ${n ? 'is-filled' : ''} ${off === undefined ? '' : off ? 'is-off' : 'is-even'}`}>
            <div className="dc-qty-head">
              <span className="dc-qty-face">{face}<small>元</small></span>
              {sum ? sum(face) : <QtySum amount={face * n} />}
            </div>
            <div className="dc-qty-ctrl">
              <button className="dc-qty-btn" type="button" aria-label={`减少一张 ${face} 元`} disabled={n <= range.min} onClick={() => set(face, n - 1)}>
                <Icon name="minus" />
              </button>
              <input className="dc-qty-input" inputMode="numeric" aria-label={`${face} 元${what}`} value={formatNet(n).replace(/,/g, '')}
                onFocus={(e) => e.target.select()} onChange={(e) => set(face, typed(e.target.value))} />
              <button className="dc-qty-btn" type="button" aria-label={`增加一张 ${face} 元`} onClick={() => set(face, n + 1)}>
                <Icon name="plus" />
              </button>
            </div>
            {off !== undefined && <p className="dc-qty-diff">{diffNotes(off)}</p>}
          </div>
        );
      })}
    </div>
  );
}

// SummaryList: name on the left, value on the right; the last row may be the total, with its minus when it is negative.
export function Summary({ rows, total }: { rows: [string, ReactNode][]; total?: [string, number] }) {
  const totalRef = useBump<HTMLElement>(total?.[1]);
  return (
    <dl className="dc-kv">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      {total && <div className="is-total"><dt>{total[0]}</dt><dd ref={totalRef}>{formatNet(total[1])}<small>HTB</small></dd></div>}
    </dl>
  );
}

// Step 1 of a visit: search the roster by name, pinyin, initials, class or number and tap the student; the next page
// shows them large for the teller to check against the student in front of them. Online the counter reads their
// balance; offline (deposits only) it goes on without one. With an empty search, `recent` offers the students this
// teller served today.
export function FindStudent({ onFound, offline, recent = [] }: { onFound: (s: Student) => void; offline?: boolean; recent?: RosterEntry[] }) {
  const me = useMe().data!;
  const roster = useRoster(me.profile.id);
  const [query, setQuery] = useState('');
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const found = useMemo(() => searchRoster(roster.data ?? [], query), [roster.data, query]);

  async function pick(s: RosterEntry) {
    if (reading) return;
    if (offline) return onFound({ ...s, division: 'primary', cohort: 0, balance: null, withdrawn_today: null });
    setReading(s.student_no);
    setError(null);
    try {
      onFound(await lookupStudent(s.student_no));
    } catch (err) {
      setError(explain(err instanceof AppError ? err.code : '', err instanceof AppError ? err.detail : {}));
      setReading(null);
    }
  }

  const list = (rows: RosterEntry[], label: string) => (
    <ul className="dc-list" aria-label={label}>
      {rows.map((s) => (
        <li key={s.student_no}>
          <a className="dc-list-link" href={`#${s.student_no}`} aria-busy={reading === s.student_no} onClick={(e) => { e.preventDefault(); pick(s); }}>
            <Avatar role="student" />
            <span>{s.name}<small className="dc-top-sub">{classOf(s)} · 学号 {s.student_no}</small></span>
            {reading === s.student_no ? <small className="dc-top-sub">正在读取</small> : <Icon name="next" />}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="dc-stack">
      {/* A form, so Enter or the phone keyboard's search key takes a single match. */}
      <form role="search" onSubmit={(e) => { e.preventDefault(); if (found.length === 1) pick(found[0]); }}>
      <label className="dc-search">
        <Icon name="query" />
        <input type="search" aria-label="搜索学生" placeholder="输入姓名、拼音首字母、班级或学号" autoComplete="off" autoFocus
          enterKeyHint="search" value={query} onChange={(e) => { setQuery(e.target.value); setError(null); }} />
        {query && <button className="dc-search-clear" type="button" aria-label="清除" onClick={() => setQuery('')}><Icon name="close" /></button>}
      </label>
      </form>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      {roster.isError && !roster.data ? (
        <div className="dc-empty">
          <span className="dc-empty-icon"><Icon name="inbox" /></span>
          <h3>这台设备还没有名册</h3>
          <p>请联网后重试。名册下载后，断网也能搜索学生。</p>
          <button className={`dc-btn dc-btn-secondary dc-btn-sm ${roster.isFetching ? 'is-loading' : ''}`} type="button" disabled={roster.isFetching} onClick={() => roster.refetch()}>重试</button>
        </div>
      ) : !query.trim() ? (
        recent.length ? (
          <>
            <p className="dc-list-title">今天办理过的学生</p>
            {list(recent, '今天办理过的学生')}
          </>
        ) : (
          <div className="dc-empty">
            <span className="dc-empty-icon"><Icon name="me" /></span>
            <h3>查找学生</h3>
            <p>姓名、拼音首字母、班级、学号都能搜<br />例如 张小明 · zxm · 四年级1班</p>
          </div>
        )
      ) : roster.isPending ? <ListLoading rows={3} label="正在加载名册" />
      : found.length ? list(found, '搜索结果') : (
        <div className="dc-empty">
          <span className="dc-empty-icon"><Icon name="query" /></span>
          <h3>没有找到「{query.trim()}」</h3>
          <p>换个写法试试：姓名、拼音首字母、班级或学号。</p>
        </div>
      )}
    </section>
  );
}

// Every counter page: the title row with back (when a flow is under way), the offline bar, and the offline deposits
// waiting to be uploaded.
export function CounterPage({ title, onBack, children }: { title: string; onBack?: () => void; children: ReactNode }) {
  const me = useMe().data!;
  const online = useOnline();
  return (
    <Page title={title} sub={me.profile.display_name} back={onBack}>
      {!online && <Notice tone="danger" title="离线登记">网络已断开，现在只能登记存款，联网后上传。请同时填写纸质凭条。</Notice>}
      {online && <PendingUploads operatorId={me.profile.id} />}
      {children}
    </Page>
  );
}

// Uploads in a row that came to nothing (no answer, a server error): the next automatic try waits longer each time.
// Kept across the bar going away while the counter is offline.
let failedUploads = 0;

function PendingUploads({ operatorId }: { operatorId: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<OfflineDeposit | null>(null);
  const [tries, setTries] = useState(failedUploads);
  const running = useRef(false);
  const queue = useQuery({ queryKey: ['offline-deposits'], queryFn: offlineQueue.list });
  const all = queue.data ?? [];
  const mine = all.filter((e) => e.operator_id === operatorId);
  const waiting = mine.filter((e) => !e.error);
  const others = all.filter((e) => e.operator_id !== operatorId);

  async function upload() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const { retry } = await offlineQueue.upload(operatorId, (e) => deposit(e.id, e.student_no, e.cash, true, e.created_at));
      setTries(failedUploads = retry ? failedUploads + 1 : 0);
    } finally {
      running.current = false;
      setBusy(false);
      queryClient.invalidateQueries({ queryKey: ['offline-deposits'] });
    }
  }
  async function retry(e: OfflineDeposit) {
    await offlineQueue.retry(e.id);
    await upload();
  }
  async function remove(e: OfflineDeposit) {
    await offlineQueue.remove(e.id);
    setRemoving(null);
    queryClient.invalidateQueries({ queryKey: ['offline-deposits'] });
  }

  // After an upload that came to nothing, try again by itself: 5 s, 15 s, 1 min, then every 5 min.
  const due = tries > 0 && waiting.length > 0 && !busy;
  useEffect(() => {
    if (!due) return;
    const timer = setTimeout(upload, retryDelay(tries));
    return () => clearTimeout(timer);
  }, [due, tries]); // eslint-disable-line react-hooks/exhaustive-deps -- upload reads the queue afresh

  if (!all.length) return null;
  return (
    <>
      {waiting.length > 0 && (
        <Notice tone="coin" icon="inbox" title={`有 ${waiting.length} 笔离线存款待上传`}
          actions={(
            <button className={`dc-btn dc-btn-primary dc-btn-sm ${busy ? 'is-loading' : ''}`} type="button" disabled={busy} onClick={upload}>
              {busy ? '正在上传' : '上传'}
            </button>
          )}>
          共 {formatAmount(waiting.reduce((s, e) => s + e.amount, 0))} HTB，按登记时间顺序入账。
        </Notice>
      )}
      {mine.filter((e) => e.error).map((e) => (
        <Notice key={e.id} tone="danger" title={`离线存款未能入账：${e.name} ${formatAmount(e.amount)} HTB`}
          actions={(
            <>
              <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" disabled={busy} onClick={() => retry(e)}>重试</button>
              <button className="dc-btn dc-btn-ghost dc-btn-sm" type="button" onClick={() => setRemoving(e)}>已核对，移除</button>
            </>
          )}>
          {explain(e.error!).title}。{describeCash(e.cash)}，{formatTime(e.created_at)} 登记，请交银行管理员核对纸质凭条。
        </Notice>
      ))}
      {removing && (
        <ConfirmSheet title="移除这笔离线存款？" confirm="移除" onClose={() => setRemoving(null)} onConfirm={() => remove(removing)}
          text={`请先和银行管理员核对 ${removing.name} ${formatAmount(removing.amount)} HTB 的纸质凭条。移除后这笔存款不会再上传，也不能恢复。`} />
      )}
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
        <a className="dc-btn dc-btn-secondary dc-btn-sm" {...link('/counter')}>去登记存款</a>
      </div>
    </div>
  );
}
