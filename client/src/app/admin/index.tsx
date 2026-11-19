import { useQuery } from '@tanstack/react-query';
import {
  AlertRow, Desk, Icon, KvLoading, link, ListLoading, MoveList, Notice, Stats, Summary, today, TxnListLoading, useAlertOverview, type IconName, type Move,
} from '@/components';
import { LEDGER, LedgerLine, type LedgerRow } from '@/components/Ledger';
import { diffAmount } from '@/lib/cash';
import type { CashReview } from '@/lib/duty';
import { dutySpan, formatAmount, formatTime } from '@/lib/format';
import { call } from '@/lib/rpc';
import { useNewRows } from '@/lib/motion';
import { useMe } from '@/lib/session';
import { readAll, supabase } from '@/lib/supabase';
import { jobFailure } from '@/lib/term';
import { toTxn } from '@/lib/txns';

const BUSINESSES = [['deposit', '存款'], ['withdraw', '取款'], ['purchase', '兑换']] as const;

// 总览: what each role looks after, every item a link to the page that handles it: today's business, the bank's
// balance, the loans outstanding with those overdue, and the latest transactions (accountant, teacher); logins that need attention (teacher, sysadmin); products
// running out and the latest stock movements (storekeeper, teacher). Teachers also see the last ledger check that
// found a difference (§9.4). Each read is only made for the roles RLS lets see it.
export default function Admin() {
  const me = useMe().data!;
  const has = (...roles: string[]) => me.roles.some((r) => roles.includes(r));
  const teacher = has('teacher'); // the president reads no audit log, where 自检 records a difference
  const money = has('accountant', 'teacher', 'president');
  const logins = has('teacher', 'sysadmin');
  const goods = has('storekeeper', 'teacher', 'president');
  const ops = has('sysadmin');
  const day = today();

  // A scheduled job that failed (PHASE-2.md §13); the notice goes once the job next succeeds.
  const jobs = useQuery({
    queryKey: ['job-runs'],
    enabled: ops,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('job_runs').select('job,done_to,last_err').not('last_err', 'is', null).order('job');
      if (error) throw error;
      return data as { job: string; done_to: string; last_err: string }[];
    },
  });

  const mismatch = useQuery({
    queryKey: ['check-mismatch'],
    enabled: teacher,
    queryFn: async () => {
      const { data, error } = await supabase.from('audit_log').select('at,after').eq('action', 'check.mismatch')
        .gte('at', new Date(Date.now() - 2 * 86400_000).toISOString()).order('at', { ascending: false }).limit(1);
      if (error) throw error;
      return (data[0] ?? null) as { at: string; after: unknown[] } | null;
    },
  });
  // Today's business across all tellers, without reversed transactions, and the balance of every account.
  const totals = useQuery({
    queryKey: ['admin-overview', 'totals', day],
    enabled: money,
    queryFn: async () => {
      // shortcut: sums on the device (the API has no aggregates); fine for one school's day and ≤ 2000 accounts, move
      // to a database function if either grows much larger.
      const [txns, accounts, loans] = await Promise.all([
        readAll((from, to) => supabase.from('txns').select('type,amount').eq('status', 'normal')
          .in('type', ['deposit', 'withdraw', 'purchase']).gte('created_at', `${day}T00:00:00+08:00`).order('seq').range(from, to)),
        readAll((from, to) => supabase.from('accounts').select('balance').order('student_no').range(from, to)),
        readAll((from, to) => supabase.from('loans').select('remaining,status').in('status', ['active', 'overdue']).order('id').range(from, to)),
      ]);
      const overdue = loans.filter((l) => l.status === 'overdue');
      return {
        txns, balance: accounts.reduce((s, a) => s + a.balance, 0), loans: loans.reduce((s, l) => s + l.remaining, 0),
        overdue: { count: overdue.length, amount: overdue.reduce((s, l) => s + l.remaining, 0) },
      };
    },
  });
  const recent = useQuery({
    queryKey: ['admin-overview', 'recent'],
    enabled: money,
    queryFn: async () => {
      const { data, error } = await supabase.from('txns').select(LEDGER)
        .order('created_at', { ascending: false }).order('seq', { ascending: false }).limit(8);
      if (error) throw error;
      return data as unknown as LedgerRow[];
    },
  });
  const todo = useQuery({
    queryKey: ['admin-overview', 'todo'],
    enabled: logins,
    queryFn: async () => {
      // A closed login (注销) is disabled for good and no longer listed, so it is not a to-do.
      const count = () => supabase.from('profiles').select('id', { count: 'exact', head: true }).is('closed_at', null);
      const [waiting, disabled] = await Promise.all([
        count().eq('login_kind', 'student').eq('must_change_password', true),
        count().eq('login_kind', 'staff').eq('disabled', true),
      ]);
      if (waiting.error || disabled.error) throw waiting.error ?? disabled.error;
      return { waiting: waiting.count ?? 0, disabled: disabled.count ?? 0 };
    },
  });
  // Under 'products' and 'stock_movements' so 出入库 and the product page refresh it.
  const low = useQuery({
    queryKey: ['products', 'low'],
    enabled: goods,
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('id,name,stock,safety_stock').eq('listed', true).eq('low', true)
        .order('stock').order('name').limit(10);
      if (error) throw error;
      return data;
    },
  });
  const moves = useQuery({
    queryKey: ['stock_movements', 'latest'],
    enabled: goods,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_movements').select('id,kind,qty_delta,note,created_at,products(id,name)')
        .order('created_at', { ascending: false }).limit(5);
      if (error) throw error;
      return data as unknown as Move[];
    },
  });

  // 待复核的轧账 (PHASE-2.md §7.2): how many wait, how many since before today, and the five waiting longest.
  const cash = useQuery({
    queryKey: ['cash-overview'],
    enabled: has('accountant', 'teacher'),
    queryFn: () => call<{ pending: number; overdue: number; oldest: CashReview[] }>('cash_review_overview', {}),
  });

  // 未处理的风险提醒 (PHASE-2.md §12.2): how many, and the five newest; the president and the bank admin only.
  const alerts = useAlertOverview(has('teacher', 'president'));

  const fresh = useNewRows(recent.data?.map((r) => r.id));

  const todos: { href: string; icon: IconName; text: string }[] = todo.data ? [
    ...(todo.data.waiting ? [{ href: '/admin/students?filter=waiting', icon: 'lock' as const, text: `${todo.data.waiting} 名学生还未设置新密码` }] : []),
    ...(todo.data.disabled ? [{ href: '/admin/staff', icon: 'warning' as const, text: `${todo.data.disabled} 个工作人员账号已停用` }] : []),
  ] : [];

  const left = money && (
    <div className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties}>
      {totals.data && (
        <Stats items={[
          ['账户余额合计', formatAmount(totals.data.balance), 'HTB'],
          ['贷款余额', formatAmount(totals.data.loans), 'HTB', totals.data.overdue.count
            ? `逾期 ${totals.data.overdue.count} 笔 · ${formatAmount(totals.data.overdue.amount)} HTB` : undefined, true],
        ]} />
      )}
      <section className="dc-card" aria-label="今日业务">
        <div className="dc-section-head" style={{ marginBottom: 'var(--space-2)' }}>
          <h2 className="heading">今日业务</h2>
          <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link(`/admin/txns?from=${day}&to=${day}`)}>今日流水<Icon name="next" /></a>
        </div>
        {totals.isError ? <p className="dc-top-sub">暂时读不到今日统计，请稍后再看。</p>
          : !totals.data ? <KvLoading rows={4} card={false} />
          : (
            <Summary total={['账户余额合计', totals.data.balance]} rows={BUSINESSES.map(([type, label]): [string, string] => {
              const of = totals.data.txns.filter((t) => t.type === type);
              return [label, `${of.length} 笔 · ${formatAmount(of.reduce((s, t) => s + t.amount, 0))} HTB`];
            })} />
          )}
      </section>
      {!!alerts.data?.open && (
        <section className="dc-stack" aria-label="未处理的风险提醒">
          <div className="dc-section-head">
            <h2 className="heading">未处理的风险提醒 · {alerts.data.open} 条</h2>
            <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link('/admin/alerts')}>去处理<Icon name="next" /></a>
          </div>
          <ul className="dc-list" aria-label="未处理的风险提醒">
            {alerts.data.recent.map((a) => <AlertRow key={a.id} a={a} href={`/admin/alerts/${a.id}?via=overview`} />)}
          </ul>
        </section>
      )}
      {!!cash.data?.pending && (
        <section className="dc-stack" aria-label="待复核的轧账">
          <div>
            <div className="dc-section-head">
              <h2 className="heading">待复核的轧账 · {cash.data.pending} 次</h2>
              <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link('/admin/cash')}>去复核<Icon name="next" /></a>
            </div>
            {!!cash.data.overdue && <p className="dc-caption is-danger">{cash.data.overdue} 次已超过一天未复核</p>}
          </div>
          <ul className="dc-list" aria-label="待复核的轧账">
            {[...cash.data.oldest].sort((a, b) => Number(b.overdue) - Number(a.overdue)).map((r) => (
              <li key={r.duty_id}>
                <a className="dc-list-link" {...link(`/admin/cash/${r.duty_id}`)}>
                  <span className="dc-list-icon"><Icon name="balance" /></span>
                  <span>
                    {r.name} · {dutySpan(r.started_at, null).split(' ')[0]}
                    {r.overdue && <> <span className="dc-tag dc-tag-danger"><Icon name="warning" />超过一天</span></>}
                    {r.status === 'forced' && <> <span className="dc-tag dc-tag-danger"><Icon name="warning" />强制下班</span></>}
                    <small className="dc-top-sub">
                      {dutySpan(r.started_at, r.ended_at).split(' ').slice(1).join(' ')} · {r.teller_total === null ? '没有柜员实点'
                        : `柜员实点 ${formatAmount(r.teller_total)} HTB · ${r.diff ? diffAmount(r.diff) : '—'}`}
                    </small>
                  </span>
                  <Icon name="next" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="dc-stack" aria-label="最近流水">
        <div className="dc-section-head">
          <h2 className="heading">最近流水</h2>
          <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link('/admin/txns')}>查看全部流水<Icon name="next" /></a>
        </div>
        {recent.isError ? <Notice tone="danger" title="暂时无法读取流水">请检查网络后刷新页面。</Notice>
          : !recent.data ? <TxnListLoading />
          : !recent.data.length ? <div className="dc-card"><p className="dc-top-sub">还没有交易。</p></div>
          : (
            <ul className="dc-txns" aria-label="最近 8 笔流水">
              {recent.data.map((r, i) => (
                <li key={r.id} style={i ? { borderTop: '2px dashed var(--line)' } : undefined}>
                  <a className={`dc-txn ${toTxn(r).kind} ${fresh.has(r.id) ? 'is-new' : ''}`} style={{ color: 'inherit', textDecoration: 'none' }}
                    {...link(`/admin/txns?student=${r.student_no}`)}>
                    <LedgerLine row={r} />
                  </a>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );

  const right = (logins || goods) && (
    <div className="dc-stack dc-enter" style={{ '--i': 2 } as React.CSSProperties}>
      {logins && (
        <section className="dc-stack" aria-label="待办">
          <h2 className="heading">待办</h2>
          {todo.isError ? <Notice tone="danger" title="暂时无法读取待办">请检查网络后刷新页面。</Notice>
            : !todo.data ? <ListLoading rows={2} label="正在加载待办" />
            : !todos.length ? <div className="dc-card"><p className="dc-top-sub">没有待办事项。</p></div>
            : (
              <ul className="dc-list">
                {todos.map((t) => (
                  <li key={t.href}>
                    <a className="dc-list-link" {...link(t.href)}>
                      <span className="dc-list-icon"><Icon name={t.icon} /></span><span>{t.text}</span><Icon name="next" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
        </section>
      )}
      {goods && (
        <>
          <section className="dc-stack" aria-label="库存不足">
            <div className="dc-section-head">
              <h2 className="heading">库存不足</h2>
              <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link('/admin/stock')}>出入库<Icon name="next" /></a>
            </div>
            {low.isError ? <Notice tone="danger" title="暂时无法读取商品">请检查网络后刷新页面。</Notice>
              : !low.data ? <ListLoading rows={2} label="正在加载商品" />
              : !low.data.length ? <div className="dc-card"><p className="dc-top-sub">已上架的商品库存都在安全库存以上。</p></div>
              : (
                <ul className="dc-list" aria-label="库存不足的商品">
                  {low.data.map((p) => (
                    <li key={p.id}>
                      <a className="dc-list-link dc-kind-exchange" {...link(`/admin/stock?product=${p.id}`)}>
                        <span className="dc-list-icon"><Icon name="exchange" /></span>
                        <span>
                          {p.name}
                          {!p.stock && <> <span className="dc-tag dc-tag-danger"><Icon name="warning" />缺货</span></>}
                          <small className="dc-top-sub">库存 {p.stock} 件 · 安全库存 {p.safety_stock} 件 · 去入库</small>
                        </span>
                        <Icon name="next" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
          </section>
          <section className="dc-stack" aria-label="最近库存变动">
            <h2 className="heading">最近库存变动</h2>
            {moves.error ? <Notice tone="danger" title="暂时无法读取库存变动">请检查网络后刷新页面。</Notice>
              : !moves.data ? <TxnListLoading rows={2} label="正在加载库存变动" />
              : !moves.data.length ? <div className="dc-card"><p className="dc-top-sub">还没有库存变动。</p></div>
              : <MoveList moves={moves.data} label="最近 5 条库存变动" />}
          </section>
        </>
      )}
    </div>
  );

  return (
    <Desk title="总览">
      {!!jobs.data?.length && (
        <Notice tone="danger" title="定时任务没有完成">
          {jobs.data.map(jobFailure).map((f) => (
            <span key={f.job}>{f.job}已处理到 {f.done}，{f.day ? `${f.day} ` : ''}没有完成：<code>{f.reason}</code>。</span>
          ))}
          在服务器上运行 <code>dolphin jobs</code> 查看，用 <code>dolphin jobs run</code> 重试。
        </Notice>
      )}
      {mismatch.data && (
        <Notice tone="danger" title="余额自检发现不一致">
          {formatTime(mismatch.data.at)} 的自检有 {mismatch.data.after.length} 处余额或库存与流水不符，请在服务器上运行 dolphin check 核对。
        </Notice>
      )}
      {left && right ? <div className="dc-split">{left}{right}</div> : left || right}
    </Desk>
  );
}
