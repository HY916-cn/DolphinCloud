import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { describeCash, type Counts } from '@/lib/cash';
import { classOf, deposit, lookupStudent, useRoster, type Student } from '@/lib/counter';
import { AppError, explain } from '@/lib/errors';
import { formatAmount } from '@/lib/format';
import { offlineQueue, type RosterEntry } from '@/lib/offline-queue';
import { useOnline } from '@/lib/online';
import { searchRoster } from '@/lib/search';
import { useMe } from '@/lib/session';
import { ConfirmSheet } from './Sheet';
import { Page } from './Shell';
import { Icon, link, Notice } from './ui';

const css = (vars: Record<string, string | number>) => vars as React.CSSProperties;

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

// Step 1 of every business: search the roster by name, pinyin, initials, class or number, pick the student, and
// confirm it is them. Online the counter then reads their balance; offline (deposits only) it goes on without one.
export function FindStudent({ onFound, offline }: { onFound: (s: Student) => void; offline?: boolean }) {
  const me = useMe().data!;
  const roster = useRoster(me.profile.id);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<RosterEntry | null>(null);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const found = useMemo(() => searchRoster(roster.data ?? [], query), [roster.data, query]);

  async function confirm() {
    if (busy) return;
    const s = picked!;
    if (offline) return onFound({ ...s, division: 'primary', cohort: 0, balance: null, withdrawn_today: null });
    setBusy(true);
    setError(null);
    try {
      onFound(await lookupStudent(s.student_no));
    } catch (err) {
      setPicked(null);
      setError(explain(err instanceof AppError ? err.code : '', err instanceof AppError ? err.detail : {}));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dc-stack">
      {/* A form, so Enter or the phone keyboard's search key picks a single match. */}
      <form role="search" onSubmit={(e) => { e.preventDefault(); if (found.length === 1) setPicked(found[0]); }}>
      <label className="dc-search">
        <Icon name="query" />
        <input type="search" aria-label="搜索学生" placeholder="输入姓名、拼音首字母、班级或学号" autoComplete="off" autoFocus
          enterKeyHint="search" value={query} onChange={(e) => { setQuery(e.target.value); setError(null); }} />
        {query && <button className="dc-search-clear" type="button" aria-label="清除" onClick={() => setQuery('')}><Icon name="close" /></button>}
      </label>
      </form>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      {!query.trim() ? (
        <div className="dc-empty">
          <span className="dc-empty-icon"><Icon name="me" /></span>
          <h3>查找学生</h3>
          <p>姓名、拼音首字母、班级、学号都能搜<br />例如 张小明 · zxm · 四年级1班{offline && <><br />离线时不显示余额</>}</p>
        </div>
      ) : found.length ? (
        <ul className="dc-list" aria-label="搜索结果">
          {found.map((s) => (
            <li key={s.student_no}>
              <a className="dc-list-link" href={`#${s.student_no}`} onClick={(e) => { e.preventDefault(); setPicked(s); }}>
                <span className="dc-list-icon"><Icon name="me" /></span>
                <span>{s.name}<small className="dc-top-sub">{classOf(s)} · 学号 {s.student_no}</small></span>
                <Icon name="next" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="dc-empty">
          <span className="dc-empty-icon"><Icon name="query" /></span>
          <h3>没有找到「{query.trim()}」</h3>
          <p>{roster.isPending ? '名册正在加载，请稍候。' : '换个写法试试：姓名、拼音首字母、班级或学号。'}</p>
        </div>
      )}
      {picked && (
        <ConfirmSheet title={`是${picked.name}吗？`} cancel="不是" confirm={busy ? '正在读取' : '是，继续办理'}
          text={<>{classOf(picked)} · 学号 {picked.student_no}<br />请当面核对学生本人。</>}
          onClose={() => setPicked(null)} onConfirm={confirm} />
      )}
    </section>
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
        <a className="dc-btn dc-btn-secondary dc-btn-sm" {...link('/counter/serve')}>去登记存款</a>
      </div>
    </div>
  );
}
