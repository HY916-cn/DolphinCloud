import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { cashTotal, describeCash, makeChange, nonEmpty, type Counts } from '@/lib/cash';
import { classOf, deposit, newId, purchase, useSettings, withdraw, type Student, type TxnResult } from '@/lib/counter';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatSigned } from '@/lib/format';
import { call } from '@/lib/rpc';
import { offlineQueue } from '@/lib/offline-queue';
import { useOnline } from '@/lib/online';
import { useBump, useNewRows } from '@/lib/motion';
import { useStaleRefusal } from '@/lib/duty';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { toTxn, type TxnRow } from '@/lib/txns';
import { CashCounter, QtySum, Summary } from './Counter';
import { FilterBar, filtered, NO_FILTER, wrongTimes, type Filter } from './Filter';
import { Stats } from './Report';
import { ConfirmSheet } from './Sheet';
import { TxnListLoading } from './Account';
import { KvLoading, TilesLoading } from './Skeleton';
import { Icon, Notice } from './ui';

// The counter's businesses for one student (PHASE-1.md §7.5, design system CounterServicePage). Each panel is the
// entry on the left and the 办理单 on the right: the businesses already done in this visit, the one being entered,
// and the balance after it. A deposit is done at once with the main button; a withdrawal or an exchange is checked
// once more in a sheet first, since its notes or goods leave the counter. A mistake is put right with 冲正 on its
// line in the 办理单. A finished business goes to onDone and the panel starts again empty;
// onEnd ends the visit. `amount` is the change to the account (null when it is untouched: a cash exchange, an
// offline deposit's balance); `txnId` is null until an offline deposit is uploaded.
export type Served = { label: string; detail: string; amount: number | null; txnNo: string | null; txnId: string | null; reversed?: boolean };
type Props = { student: Student; served: Served[]; onDone: (s: Served) => void; onEnd: () => void; onReverse: (s: Served) => void };
type Problem = { title: string; text: string } | null;
type Current = { label: string; detail: string; amount: string } | null;

const failure = (e: unknown) => {
  const err = e instanceof AppError ? e : new AppError('');
  return { err, problem: explain(err.code, err.detail) };
};

export const servedAmount = (s: Served) => (s.amount === null ? '现金' : formatSigned(s.amount));

// 办理单: what this visit has done (newest last, popping in, each with its 冲正), the business being entered, the
// balance after it, and the one way to end the visit.
function Receipt({ served, current, after, onEnd, onReverse }: {
  served: Served[]; current: Current; after: number | string | null; onEnd: () => void; onReverse: (s: Served) => void;
}) {
  return (
    <aside className="dc-card is-sticky" aria-label="办理单">
      <h2 className="heading has-gap">办理单</h2>
      <dl className="dc-kv" aria-live="polite">
        {served.map((s, i) => (
          <div key={i} className="dc-pop" style={s.reversed ? { opacity: 0.6 } : undefined}>
            <dt>
              {s.label}{s.reversed && '（已冲正）'}
              <small className="dc-top-sub">{[s.detail, s.txnNo ?? '联网后入账'].filter(Boolean).join(' · ')}</small>
              {s.txnId && !s.reversed && (
                <button className="dc-btn dc-btn-ghost dc-btn-sm dc-btn-inline" type="button" style={{ marginTop: 'var(--space-1)' }}
                  aria-label={`冲正${s.label}`} onClick={() => onReverse(s)}><Icon name="transfer" />冲正</button>
              )}
            </dt>
            <dd>{servedAmount(s)}</dd>
          </div>
        ))}
        {current && <div><dt>{current.label}（正在办理）<small className="dc-top-sub">{current.detail}</small></dt><dd>{current.amount}</dd></div>}
        {current && after !== null && <div><dt>办理后余额</dt><dd>{typeof after === 'number' ? `${formatAmount(after)} HTB` : after}</dd></div>}
        {!served.length && !current && <div><dt>还没有办理业务</dt><dd /></div>}
      </dl>
      {served.length > 0 && (
        <button className="dc-btn dc-btn-secondary dc-btn-block" type="button" style={{ marginTop: 'var(--space-4)' }} onClick={onEnd}>
          结束办理 {served.filter((s) => !s.reversed).length} 笔
        </button>
      )}
    </aside>
  );
}

// The bar under every panel: the business's main button and its total.
function Bar({ busy, ready, label, onClick, totalLabel, total, note }: {
  busy: boolean; ready: boolean; label: string; onClick: () => void; totalLabel: string; total: number; note?: ReactNode;
}) {
  const totalRef = useBump<HTMLElement>(total);
  return (
    <div className="dc-actions">
      <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button" disabled={busy || !ready} onClick={onClick}>
        {label}
      </button>
      <div className="dc-actions-total">
        <span>{totalLabel}{note && <small>{note}</small>}</span>
        <b ref={totalRef}>{formatAmount(total)}<small>HTB</small></b>
      </div>
    </div>
  );
}

// 存款: count the notes by face value. Offline, or when the call gets no answer, the deposit is registered on this
// device and uploaded later under the same id (§7.7).
export function DepositPanel({ student, served, onDone, onEnd, onReverse }: Props) {
  const me = useMe().data!;
  const online = useOnline();
  const { denominations } = useSettings();
  const queryClient = useQueryClient();
  const stale = useStaleRefusal();
  const [counts, setCounts] = useState<Counts>({});
  const [id, setId] = useState(newId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Problem>(null);
  const amount = cashTotal(counts);
  // Offline the deposit is only registered, so there is no balance after it to show yet.
  const after = !online || student.balance === null ? null : student.balance + amount;

  function finish(result: TxnResult | null) {
    onDone(result
      ? { label: '存款', detail: describeCash(counts), amount, txnNo: result.txn_no, txnId: result.id }
      : { label: '存款（离线登记）', detail: describeCash(counts), amount, txnNo: null, txnId: null });
    setCounts({});
    setId(newId());
  }

  async function submit() {
    if (busy) return; // the same id is idempotent on the server too
    setBusy(true);
    setError(null);
    const queue = () => offlineQueue.add({
      id, student_no: student.student_no, name: student.name, class: classOf(student), cash: nonEmpty(counts), amount,
      operator_id: me.profile.id, operator_name: me.profile.display_name, created_at: new Date().toISOString(),
    }).then(() => queryClient.invalidateQueries({ queryKey: ['offline-deposits'] }));
    try {
      if (!online) {
        await queue();
        finish(null);
      } else {
        finish(await deposit(id, student.student_no, nonEmpty(counts)));
      }
    } catch (e) {
      stale(e);
      const { err, problem } = failure(e);
      if (err.code === 'NETWORK') {
        await queue();
        finish(null);
      } else {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="dc-split">
        <section className="dc-stack">
          <h2 className="heading">按面额录入张数</h2>
          <CashCounter faces={denominations} counts={counts} onChange={setCounts} kind="dc-kind-save" />
        </section>
        <Receipt served={served} onEnd={onEnd} onReverse={onReverse} after={online ? after : '待上传'}
          current={amount > 0 ? { label: '存款', detail: describeCash(counts), amount: formatSigned(amount) } : null} />
      </div>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <Bar busy={busy} ready={amount > 0} onClick={submit}
        label={busy ? '正在存款' : amount > 0 ? `确认存款 ${formatAmount(amount)} HTB` : '请录入张数'}
        totalLabel="合计存入" total={amount} note={after !== null && `存入后余额 ${formatAmount(after)} HTB`} />
    </>
  );
}

// 取款: the amount, the notes to pay out, and what is still allowed today.
export function WithdrawPanel({ student, served, onDone, onEnd, onReverse }: Props) {
  const settings = useSettings();
  const stale = useStaleRefusal();
  const [text, setText] = useState('');
  const [id, setId] = useState(newId);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<Problem>(null);
  const amount = Number(text) || 0;

  const balance = student.balance ?? 0;
  const single = settings.single[student.division];
  const daily = settings.daily[student.division];
  const todayLeft = daily === undefined ? undefined : Math.max(daily - (student.withdrawn_today ?? 0), 0);
  // Checked again by withdraw(); shown here so the teller sees the reason before confirming.
  const problem =
    !amount ? null
    : amount > balance ? `余额不足：可用余额 ${formatAmount(balance)} HTB，还差 ${formatAmount(amount - balance)} HTB`
    : single !== undefined && amount > single ? `超过单笔取款限额 ${formatAmount(single)} HTB`
    : todayLeft !== undefined && amount > todayLeft ? `超过今日取款限额：今日还可取款 ${formatAmount(todayLeft)} HTB`
    : null;
  const payout = describeCash(makeChange(amount, settings.denominations));

  async function submit() {
    if (busy) return; // the same id is idempotent on the server too
    setBusy(true);
    setError(null);
    try {
      const result = await withdraw(id, student.student_no, amount);
      onDone({ label: '取款', detail: `配钞 ${describeCash(result.denominations ?? {})}`, amount: -amount, txnNo: result.txn_no, txnId: result.id });
      setText('');
      setId(newId());
    } catch (e) {
      stale(e);
      setError(failure(e).problem);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <div className="dc-split">
        <section className="dc-stack">
          <label className={`dc-field ${problem ? 'is-error' : ''}`}>
            <span className="dc-field-label"><Icon name="withdraw" />取款金额</span>
            <span className="dc-input-wrap">
              <input className="dc-input" inputMode="numeric" autoFocus value={text} placeholder="请输入金额"
                onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              <span className="dc-input-unit">HTB</span>
            </span>
            <span className="dc-field-hint">
              {problem ? <><Icon name="warning" />{problem}</> : amount ? `配钞：${payout}` : `单笔最多 ${single ?? '—'} HTB`}
            </span>
          </label>
        </section>
        <Receipt served={served} onEnd={onEnd} onReverse={onReverse} after={Math.max(balance - amount, 0)}
          current={amount ? { label: '取款', detail: `配钞 ${payout}`, amount: formatSigned(-amount) } : null} />
      </div>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <Bar busy={busy} ready={!!amount && !problem} onClick={() => setConfirming(true)}
        label={busy ? '正在取款' : !amount ? '请输入金额' : problem ? '金额超出可取范围' : `确认取款 ${formatAmount(amount)} HTB`}
        totalLabel="合计取款" total={amount} note={`取款后余额 ${formatAmount(Math.max(balance - amount, 0))} HTB`} />
      {confirming && (
        <ConfirmSheet title={`为${student.name}取款 ${formatAmount(amount)} HTB？`} text="请核对金额，确认后按下面的配钞付给学生。"
          confirm="确认取款" busy={busy} onConfirm={submit} onClose={() => setConfirming(false)}>
          <Summary rows={[
            ['学生', `${student.name} · 学号 ${student.student_no}`], ['取款金额', `${formatAmount(amount)} HTB`], ['配钞', payout],
            ['取款后余额', `${formatAmount(Math.max(balance - amount, 0))} HTB`],
          ]} />
        </ConfirmSheet>
      )}
    </>
  );
}

type Product = { id: string; name: string; price: number; stock: number; image_path: string | null };
const imageUrl = (path: string) => supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;

// 兑换: pick products, then pay from the account or in cash with change worked out.
export function ShopPanel({ student, served, onDone, onEnd, onReverse }: Props) {
  const { denominations } = useSettings();
  const products = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('id,name,price,stock,image_path').eq('listed', true)
        .order('category').order('name');
      if (error) throw error;
      return data as Product[];
    },
  });
  const stale = useStaleRefusal();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [payment, setPayment] = useState<'account' | 'cash'>('account');
  const [received, setReceived] = useState<Counts>({});
  const [id, setId] = useState(newId);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<Problem>(null);

  const list = products.data ?? [];
  const lines = list.filter((p) => cart[p.id]).map((p) => ({ ...p, qty: cart[p.id] }));
  const due = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const paid = cashTotal(received);
  const change = Math.max(paid - due, 0);
  const items = lines.map((l) => `${l.name} × ${l.qty}`).join('、');
  const setQty = (p: Product, n: number) => setCart({ ...cart, [p.id]: Math.max(0, Math.min(p.stock, n)) });
  const balance = student.balance ?? 0;
  const problem =
    !lines.length ? '请选择商品'
    : payment === 'account' && due > balance ? `余额不足，还差 ${formatAmount(due - balance)} HTB`
    : payment === 'cash' && paid < due ? `收款不足，还差 ${formatAmount(due - paid)} HTB`
    : null;

  async function submit() {
    if (busy) return; // the same id is idempotent on the server too
    setBusy(true);
    setError(null);
    try {
      const result = await purchase(id, student.student_no, lines.map((l) => ({ product_id: l.id, qty: l.qty })), payment,
        payment === 'cash' ? nonEmpty(received) : undefined);
      onDone(payment === 'account'
        ? { label: `兑换 ${items}`, detail: '账户支付', amount: -due, txnNo: result.txn_no, txnId: result.id }
        : { label: `兑换 ${items}`, amount: null, txnNo: result.txn_no, txnId: result.id,
            detail: `现金收 ${formatAmount(paid)} HTB，找零 ${formatAmount(change)} HTB（${describeCash(result.change_given ?? {}) || '不用找零'}）` });
      setCart({});
      setPayment('account');
      setReceived({});
      setId(newId());
    } catch (e) {
      stale(e);
      const { err, problem } = failure(e);
      setError(problem);
      if (err.code === 'OUT_OF_STOCK' || err.code === 'PRODUCT_UNLISTED' || err.code === 'PRODUCT_NOT_FOUND') products.refetch();
    } finally {
      setBusy(false);
      setConfirming(false);
      products.refetch();
    }
  }

  return (
    <>
      <div className="dc-split">
        <section className="dc-stack">
          <h2 className="heading">选择商品</h2>
          {products.error ? <Notice tone="danger" title="暂时无法读取商品">请检查网络后重试。</Notice> : products.isPending ? <TilesLoading /> : (
            <div className="dc-tiles">
              {list.map((p) => (
                <button key={p.id} type="button" className="dc-tile dc-kind-exchange" disabled={!p.stock} onClick={() => setQty(p, (cart[p.id] ?? 0) + 1)}
                  style={p.stock ? undefined : { opacity: 0.5, cursor: 'not-allowed' }}
                  aria-label={`${p.name}，${p.price} HTB，${p.stock ? `库存 ${p.stock}` : '已售罄'}`}>
                  <span className="dc-tile-icon">
                    {p.image_path ? <img src={imageUrl(p.image_path)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
                      : <Icon name="exchange" />}
                  </span>
                  {p.name}
                  <small>{p.price} HTB · {p.stock ? `库存 ${p.stock}` : '已售罄'}</small>
                </button>
              ))}
            </div>
          )}
          {lines.length > 0 && (
            <>
              <h2 className="heading is-section">已选商品</h2>
              <div className="dc-denoms dc-kind-exchange">
                {lines.map((l) => (
                  <div key={l.id} className="dc-qty is-product is-filled">
                    <div className="dc-qty-head">
                      <span className="dc-qty-name">{l.name}</span>
                      <QtySum amount={l.price * l.qty} />
                    </div>
                    <div className="dc-qty-ctrl">
                      <button className="dc-qty-btn" type="button" aria-label={`减少一件${l.name}`} onClick={() => setQty(l, l.qty - 1)}><Icon name="minus" /></button>
                      <input className="dc-qty-input" readOnly aria-label={`${l.name}数量`} value={l.qty} />
                      <button className="dc-qty-btn" type="button" aria-label={`增加一件${l.name}`} disabled={l.qty >= l.stock} onClick={() => setQty(l, l.qty + 1)}><Icon name="plus" /></button>
                    </div>
                  </div>
                ))}
              </div>
              <h2 className="heading is-section">付款方式</h2>
              <div className="dc-choices dc-kind-exchange" role="radiogroup" aria-label="付款方式">
                {([['account', 'savings', '账户扣款', `可用余额 ${formatAmount(balance)} HTB`], ['cash', 'coin', '现金支付', '收款并找零']] as const)
                  .map(([value, icon, name, note]) => (
                    <label key={value} className="dc-choice">
                      <input type="radio" name="payment" checked={payment === value} onChange={() => setPayment(value)} />
                      <span className="dc-choice-icon"><Icon name={icon} /></span>
                      <span><b>{name}</b><small>{note}</small></span>
                    </label>
                  ))}
              </div>
              {payment === 'cash' && (
                <>
                  <h2 className="heading is-section">录入收到的现金</h2>
                  <CashCounter faces={denominations} counts={received} onChange={setReceived} kind="dc-kind-exchange" />
                </>
              )}
            </>
          )}
        </section>
        <Receipt served={served} onEnd={onEnd} onReverse={onReverse} after={payment === 'account' ? Math.max(balance - due, 0) : balance}
          current={lines.length ? {
            label: `兑换 ${items}`,
            detail: payment === 'account' ? '账户支付'
              : `现金收 ${formatAmount(paid)} HTB${change ? `，找零 ${describeCash(makeChange(change, denominations))}` : ''}`,
            amount: payment === 'account' ? formatSigned(-due) : '现金',
          } : null} />
      </div>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <Bar busy={busy} ready={!problem} onClick={() => setConfirming(true)}
        label={busy ? '正在兑换' : problem ?? `确认兑换 ${formatAmount(due)} HTB`}
        totalLabel="应付" total={due} note={payment === 'cash' && change > 0 && `找零 ${formatAmount(change)} HTB`} />
      {confirming && (
        <ConfirmSheet title={`为${student.name}兑换 ${formatAmount(due)} HTB 的商品？`} text="请核对商品和付款方式，确认后把商品交给学生。"
          confirm="确认兑换" busy={busy} onConfirm={submit} onClose={() => setConfirming(false)}>
          <Summary rows={[
            ['学生', `${student.name} · 学号 ${student.student_no}`], ['商品', items], ['应付', `${formatAmount(due)} HTB`],
            ...(payment === 'account'
              ? [['付款方式', '账户扣款'], ['扣款后余额', `${formatAmount(Math.max(balance - due, 0))} HTB`]] as [string, string][]
              : [['付款方式', '现金支付'], ['收款', `${formatAmount(paid)} HTB`],
                  ['找零', change ? `${formatAmount(change)} HTB（${describeCash(makeChange(change, denominations))}）` : '不用找零']] as [string, string][]),
          ]} />
        </ConfirmSheet>
      )}
    </>
  );
}

const HISTORY = 10;
type HistoryRow = Omit<TxnRow, 'txn_items'> & { seq: number; txn_no: string; balance_after: number; operator: string; items: { name: string; qty: number }[] };

const QUERY_KINDS = [['deposit', '存款'], ['withdraw', '取款'], ['purchase', '兑换'], ['reversal', '冲正'], ['salary', '工资'], ['interest', '利息'], ['opening', '期初']] as const;

// 查询: the student's account totals and every transaction, also other tellers' and earlier days', newest first,
// ten at a time (student_txns), filtered as 流水 is: the days, a 时段, the types, and words of a 交易号 or a product.
// It takes the whole width; the 办理单 is back with the next business. Read again after each business of the visit.
export function QueryPanel({ student, served }: Props) {
  const done = served.length + served.filter((s) => s.reversed).length;
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const account = useQuery({
    queryKey: ['counter-account', student.student_no, done],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('balance,total_in,total_out,total_spent').eq('student_no', student.student_no).single();
      if (error) throw error;
      return data;
    },
  });
  const badTime = wrongTimes(filter);
  const history = useInfiniteQuery({
    queryKey: ['counter-history', student.student_no, done, filter],
    enabled: !badTime,
    initialPageParam: null as number | null,
    getNextPageParam: (last: HistoryRow[]) => (last.length === HISTORY ? last[last.length - 1].seq : undefined),
    queryFn: ({ pageParam }) => call<HistoryRow[]>('student_txns', {
      p_student_no: student.student_no, p_before: pageParam, p_limit: HISTORY, p_from: filter.from || null, p_to: filter.to || null,
      p_time_from: filter.timeFrom || null, p_time_to: filter.timeTo || null, p_types: filter.kinds.length ? filter.kinds : null,
      p_search: filter.text.trim() || null,
    }),
  });
  const rows = history.data?.pages.flat();
  const a = account.data;
  const fresh = useNewRows(rows?.map((r) => r.id), JSON.stringify(filter));
  return (
    <section className="dc-stack dc-enter" aria-label="账户查询">
      {a ? (
        <Stats items={[['当前余额', formatAmount(a.balance), 'HTB'], ['累计存入', formatAmount(a.total_in), 'HTB'],
          ['累计取出', formatAmount(a.total_out), 'HTB'], ['累计账户兑换', formatAmount(a.total_spent), 'HTB']]} />
      ) : account.error ? <Notice tone="danger" title="暂时无法读取账户">请检查网络后再试一次。</Notice> : <KvLoading rows={2} />}
      <FilterBar label="筛选交易记录" placeholder="搜索交易号或商品" value={filter} onChange={setFilter} kinds={QUERY_KINDS} />
      {badTime ? <Notice tone="danger" title="时段有误">结束时间要晚于开始时间。</Notice>
        : history.error && !rows ? <Notice tone="danger" title="暂时无法读取交易记录">请检查网络后再试一次。</Notice>
        : !rows ? <TxnListLoading />
        : rows.length ? (
          <ul className="dc-txns" aria-label="交易记录">
            {rows.map((r) => {
              const t = toTxn({ ...r, txn_items: r.items });
              return (
                <li key={r.id} className={`dc-txn ${t.kind} ${fresh.has(r.id) ? 'is-new' : ''}`} style={r.status === 'reversed' ? { opacity: 0.6 } : undefined}>
                  <span className="dc-txn-icon"><Icon name={t.icon} /></span>
                  <div className="dc-txn-main">
                    <div className="dc-txn-title">{t.title}</div>
                    <div className="dc-txn-time">{t.time} · 经办人 {r.operator}</div>
                    <div className="dc-txn-time">交易号 {r.txn_no} · 办理后余额 {formatAmount(r.balance_after)} HTB</div>
                  </div>
                  <div className={`dc-txn-amount ${t.amount > 0 ? 'is-in' : ''}`}>
                    {t.amount ? formatSigned(t.amount) : formatAmount(t.paid)}<small>{t.note}</small>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="dc-top-sub">{filtered(filter) ? '没有符合条件的交易记录。' : '还没有交易记录。'}</p>}
      {history.isFetchingNextPage && <TxnListLoading rows={2} />}
      {history.error && rows && <Notice tone="danger" title="暂时无法读取更多记录">请检查网络后再试一次。</Notice>}
      {history.hasNextPage && !history.isFetchingNextPage && (
        <button className="dc-btn dc-btn-secondary dc-btn-block" type="button" onClick={() => history.fetchNextPage()}>加载更多</button>
      )}
    </section>
  );
}
