import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { cashTotal, describeCash, makeChange, nonEmpty, type Counts } from '@/lib/cash';
import { classOf, deposit, newId, purchase, reverseTxn, useSettings, withdraw, type Student, type TxnResult } from '@/lib/counter';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatTime } from '@/lib/format';
import { offlineQueue } from '@/lib/offline-queue';
import { useOnline } from '@/lib/online';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { CashCounter, Summary } from './Counter';
import { ConfirmSheet } from './Sheet';
import { Icon, Notice } from './ui';

// The counter's businesses for one student (PHASE-1.md §7.5), shown as tabs on the 办理 page once the student is
// confirmed. Each panel reports a finished business through onDone and starts again empty; onEnd ends the visit.
export type Served = { label: string; lead: ReactNode; txnNo: string | null };
type Props = { student: Student; onDone: (s: Served) => void; onEnd: () => void };
type Problem = { title: string; text: string } | null;

const failure = (e: unknown) => {
  const err = e instanceof AppError ? e : new AppError('');
  return { err, problem: explain(err.code, err.detail) };
};

// The bar under every panel: end the visit (wider screens), the business's main button, and its total.
function Bar({ onEnd, busy, ready, label, onClick, totalLabel, total, note }: {
  onEnd: () => void; busy: boolean; ready: boolean; label: string; onClick: () => void;
  totalLabel: string; total: number; note?: ReactNode;
}) {
  return (
    <div className="dc-actions">
      <button className="dc-btn dc-btn-secondary dc-hide-phone" type="button" onClick={onEnd}>结束办理</button>
      <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button" disabled={!busy && !ready} onClick={onClick}>
        {label}
      </button>
      <div className="dc-actions-total">
        <span>{totalLabel}{note && <small>{note}</small>}</span>
        <b>{formatAmount(total)}<small>HTB</small></b>
      </div>
    </div>
  );
}

// 存款: count the notes by face value. Offline, or when the call gets no answer, the deposit is registered on this
// device and uploaded later under the same id (§7.7).
export function DepositPanel({ student, onDone, onEnd }: Props) {
  const me = useMe().data!;
  const online = useOnline();
  const { denominations } = useSettings();
  const queryClient = useQueryClient();
  const [counts, setCounts] = useState<Counts>({});
  const [id, setId] = useState(newId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Problem>(null);
  const amount = cashTotal(counts);
  const after = student.balance === null ? null : student.balance + amount;

  function finish(result: TxnResult | null) {
    onDone(result
      ? { label: `存款 ${formatAmount(amount)} HTB`, txnNo: result.txn_no,
          lead: <>存入 <b>{formatAmount(amount)} HTB</b>（{describeCash(counts)}），当前余额 <b>{formatAmount(result.balance_after)}</b> HTB</> }
      : { label: `登记存款 ${formatAmount(amount)} HTB`, txnNo: null,
          lead: <>登记 <b>{formatAmount(amount)} HTB</b>（{describeCash(counts)}），联网后入账</> });
    setCounts({});
    setId(newId());
  }

  async function submit() {
    setConfirming(false);
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
          <CashCounter faces={denominations} counts={counts} onChange={setCounts} />
        </section>
        <aside className="dc-card is-sticky dc-hide-phone">
          <h2 className="heading" style={{ marginBottom: 'var(--space-2)' }}>核对金额</h2>
          <Summary
            rows={[
              ...Object.entries(nonEmpty(counts)).sort(([a], [b]) => Number(b) - Number(a))
                .map(([face, n]): [string, ReactNode] => [`${face} 元 × ${n} 张`, formatAmount(Number(face) * n)]),
              ...(after === null ? [] : [['存入后余额', `${formatAmount(after)} HTB`] as [string, string]]),
            ]}
            total={['合计存入', amount]} />
        </aside>
      </div>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <Bar onEnd={onEnd} busy={busy} ready={amount > 0} onClick={() => setConfirming(true)}
        label={busy ? '正在存款' : amount > 0 ? '确认存款' : '请录入张数'}
        totalLabel="合计存入" total={amount} note={after !== null && `存入后余额 ${formatAmount(after)} HTB`} />
      {confirming && (
        <ConfirmSheet title="确认存款" confirm="确认存款" onClose={() => setConfirming(false)} onConfirm={submit}
          text={<>为 <b>{student.name}</b> 存款 <b>{formatAmount(amount)} HTB</b>{online ? '' : '（离线登记，联网后入账）'}</>} />
      )}
    </>
  );
}

// 取款: the amount, the notes to pay out, and what is still allowed today.
export function WithdrawPanel({ student, onDone, onEnd }: Props) {
  const settings = useSettings();
  const [text, setText] = useState('');
  const [id, setId] = useState(newId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Problem>(null);
  const amount = Number(text) || 0;

  const balance = student.balance ?? 0;
  const single = settings.single[student.division];
  const daily = settings.daily[student.division];
  const todayLeft = daily === undefined ? undefined : Math.max(daily - (student.withdrawn_today ?? 0), 0);
  // Checked again by withdraw(); shown here so the teller sees the reason before confirming.
  const problem =
    !amount ? null
    : amount > balance ? `余额不足：可用余额 ${formatAmount(balance)} HTB`
    : single !== undefined && amount > single ? `超过单笔取款限额 ${formatAmount(single)} HTB`
    : todayLeft !== undefined && amount > todayLeft ? `超过今日取款限额：今日还可取款 ${formatAmount(todayLeft)} HTB`
    : null;
  const payout = describeCash(makeChange(amount, settings.denominations));

  async function submit() {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      const result = await withdraw(id, student.student_no, amount);
      onDone({ label: `取款 ${formatAmount(amount)} HTB`, txnNo: result.txn_no,
        lead: <>取款 <b>{formatAmount(amount)} HTB</b>，配钞 {payout}，当前余额 <b>{formatAmount(result.balance_after)}</b> HTB</> });
      setText('');
      setId(newId());
    } catch (e) {
      setError(failure(e).problem);
    } finally {
      setBusy(false);
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
        <aside className="dc-card is-sticky dc-hide-phone">
          <h2 className="heading" style={{ marginBottom: 'var(--space-2)' }}>核对金额</h2>
          <Summary rows={[
            ['配钞方案', amount ? payout : '—'],
            ['可用余额', `${formatAmount(balance)} HTB`],
            ['今日还可取', todayLeft === undefined ? '—' : `${formatAmount(todayLeft)} HTB`],
            ['取款后余额', `${formatAmount(Math.max(balance - amount, 0))} HTB`],
          ]} total={['合计取款', amount]} />
        </aside>
      </div>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <Bar onEnd={onEnd} busy={busy} ready={!!amount && !problem} onClick={() => setConfirming(true)}
        label={busy ? '正在取款' : !amount ? '请输入金额' : problem ? '金额超出可取范围' : '确认取款'}
        totalLabel="合计取款" total={amount} note={`取款后余额 ${formatAmount(Math.max(balance - amount, 0))} HTB`} />
      {confirming && (
        <ConfirmSheet title="确认取款" confirm="确认取款" onClose={() => setConfirming(false)} onConfirm={submit}
          text={<>为 <b>{student.name}</b> 取款 <b>{formatAmount(amount)} HTB</b>，配钞 {payout}</>} />
      )}
    </>
  );
}

type Product = { id: string; name: string; price: number; stock: number; image_path: string | null };
const imageUrl = (path: string) => supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;

// 兑换: pick products, then pay from the account or in cash with change worked out.
export function ShopPanel({ student, onDone, onEnd }: Props) {
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
  const [cart, setCart] = useState<Record<string, number>>({});
  const [payment, setPayment] = useState<'account' | 'cash'>('account');
  const [received, setReceived] = useState<Counts>({});
  const [id, setId] = useState(newId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
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
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      const result = await purchase(id, student.student_no, lines.map((l) => ({ product_id: l.id, qty: l.qty })), payment,
        payment === 'cash' ? nonEmpty(received) : undefined);
      onDone({ label: `兑换 ${items}`, txnNo: result.txn_no,
        lead: payment === 'account'
          ? <>兑换 {items}，账户支付 <b>{formatAmount(due)} HTB</b>，当前余额 <b>{formatAmount(result.balance_after)}</b> HTB</>
          : <>兑换 {items}，现金收款 <b>{formatAmount(paid)} HTB</b>，找零 <b>{formatAmount(change)}</b> HTB（{describeCash(result.change_given ?? {}) || '不用找零'}）</> });
      setCart({});
      setPayment('account');
      setReceived({});
      setId(newId());
    } catch (e) {
      const { err, problem } = failure(e);
      setError(problem);
      if (err.code === 'OUT_OF_STOCK' || err.code === 'PRODUCT_UNLISTED') products.refetch();
    } finally {
      setBusy(false);
      products.refetch();
    }
  }

  return (
    <>
      <div className="dc-split">
        <section className="dc-stack">
          <h2 className="heading">选择商品</h2>
          {products.error ? <Notice tone="danger" title="暂时无法读取商品">请检查网络后重试。</Notice> : (
            <div className="dc-tiles">
              {list.map((p) => (
                <button key={p.id} type="button" className="dc-tile" disabled={!p.stock} onClick={() => setQty(p, (cart[p.id] ?? 0) + 1)}
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
              <h2 className="heading" style={{ marginTop: 'var(--space-2)' }}>已选商品</h2>
              <div className="dc-denoms">
                {lines.map((l) => (
                  <div key={l.id} className="dc-qty is-filled">
                    <div className="dc-qty-head">
                      <span className="dc-qty-face" style={{ fontSize: 18 }}>{l.name}</span>
                      <span className="dc-qty-sum">小计<b>{formatAmount(l.price * l.qty)}</b></span>
                    </div>
                    <div className="dc-qty-ctrl">
                      <button className="dc-qty-btn" type="button" aria-label={`减少一件${l.name}`} onClick={() => setQty(l, l.qty - 1)}><Icon name="minus" /></button>
                      <input className="dc-qty-input" readOnly aria-label={`${l.name}数量`} value={l.qty} />
                      <button className="dc-qty-btn" type="button" aria-label={`增加一件${l.name}`} disabled={l.qty >= l.stock} onClick={() => setQty(l, l.qty + 1)}><Icon name="plus" /></button>
                    </div>
                  </div>
                ))}
              </div>
              <h2 className="heading" style={{ marginTop: 'var(--space-2)' }}>付款方式</h2>
              <div className="dc-choices" role="radiogroup" aria-label="付款方式">
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
                  <h2 className="heading" style={{ marginTop: 'var(--space-2)' }}>录入收到的现金</h2>
                  <CashCounter faces={denominations} counts={received} onChange={setReceived} />
                </>
              )}
            </>
          )}
        </section>
        <aside className="dc-card is-sticky dc-hide-phone">
          <h2 className="heading" style={{ marginBottom: 'var(--space-2)' }}>核对金额</h2>
          <Summary rows={[
            ...lines.map((l): [string, string] => [`${l.name} × ${l.qty}`, formatAmount(l.price * l.qty)]),
            ...(payment === 'account'
              ? [['支付后余额', `${formatAmount(Math.max(balance - due, 0))} HTB`] as [string, string]]
              : [['已收现金', `${formatAmount(paid)} HTB`], ['找零', change ? describeCash(makeChange(change, denominations)) : '—']] as [string, string][]),
          ]} total={['应付', due]} />
        </aside>
      </div>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <Bar onEnd={onEnd} busy={busy} ready={!problem} onClick={() => setConfirming(true)}
        label={busy ? '正在兑换' : problem ?? '确认兑换'}
        totalLabel="应付" total={due} note={payment === 'cash' && change > 0 && `找零 ${formatAmount(change)} HTB`} />
      {confirming && (
        <ConfirmSheet title="确认兑换" confirm="确认兑换" onClose={() => setConfirming(false)} onConfirm={submit}
          text={payment === 'account'
            ? <>为 <b>{student.name}</b> 兑换 {items}，账户扣款 <b>{formatAmount(due)} HTB</b></>
            : <>为 <b>{student.name}</b> 兑换 {items}，现金收 <b>{formatAmount(paid)} HTB</b>{change ? `，找零 ${describeCash(makeChange(change, denominations))}` : ''}</>} />
      )}
    </>
  );
}

const STATUS: Record<string, string> = { normal: '正常', frozen: '已冻结', graduated: '已毕业' };

// 查询: the student's account and today's withdrawal room, without any business.
export function LookupPanel({ student, onEnd }: Pick<Props, 'student' | 'onEnd'>) {
  const settings = useSettings();
  const daily = settings.daily[student.division];
  return (
    <>
      <div className="dc-card dc-enter">
        <Summary rows={[
          ['余额', `${formatAmount(student.balance ?? 0)} HTB`],
          ['今日已取款', `${formatAmount(student.withdrawn_today ?? 0)} HTB`],
          ['今日还可取', daily === undefined ? '—' : `${formatAmount(Math.max(daily - (student.withdrawn_today ?? 0), 0))} HTB`],
          ['学部', student.division === 'junior' ? '初中部' : '小学部'],
          ['学届', `${student.cohort} 届`],
          ['账户状态', STATUS[student.status] ?? student.status],
        ]} />
      </div>
      <div className="dc-actions">
        <button className="dc-btn dc-btn-secondary" type="button" onClick={onEnd}>结束办理</button>
      </div>
    </>
  );
}

type Txn = {
  id: string; txn_no: string; type: 'deposit' | 'withdraw' | 'purchase'; amount: number; payment: 'account' | 'cash' | null;
  denominations: Record<string, number> | null; created_at: string; student_no: string;
  students: { name: string; class_no: number; class_label: string | null };
  txn_items: { name: string; qty: number }[];
};
const KIND = { deposit: '存款', withdraw: '取款', purchase: '兑换' };
const REASONS = ['金额录错', '学号录错', '业务选错', '其他'];

const describe = (t: Txn) =>
  t.type === 'purchase' ? `兑换 ${t.txn_items.map((i) => `${i.name} × ${i.qty}`).join('、')}（${t.payment === 'cash' ? '现金' : '账户'}）`
  : `${KIND[t.type]} ${formatAmount(t.amount)} HTB`;

// 冲正 (PHASE-1.md §6.3): pick one of today's own businesses (RLS shows a teller only those), give the reason,
// confirm. The original stays and is marked 已冲正. With a student, only that student's businesses are listed;
// without one (the 冲正 page) the list is searched by transaction or student number.
export function ReversalPanel({ student, onDone, onEnd }: { student?: Student; onDone: (s: Served) => void; onEnd?: () => void }) {
  const me = useMe().data!;
  const today = useQuery({
    queryKey: ['my-txns-today', me.profile.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('txns')
        .select('id,txn_no,type,amount,payment,denominations,created_at,student_no,students(name,class_no,class_label),txn_items(name,qty)')
        .eq('operator_id', me.profile.id).eq('status', 'normal').in('type', ['deposit', 'withdraw', 'purchase'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as Txn[];
    },
  });
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Txn | null>(null);
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [id, setId] = useState(newId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Problem>(null);
  const fullReason = reason === '其他' ? `其他：${other.trim()}` : reason;

  function back() {
    setPicked(null);
    setReason('');
    setOther('');
    setError(null);
  }

  async function submit() {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      const result = await reverseTxn(id, picked!.id, fullReason);
      onDone({ label: `冲正 ${picked!.txn_no}`, txnNo: result.txn_no,
        lead: <>已冲正{picked!.students.name}的{describe(picked!)}，原因：{fullReason}，当前余额 <b>{formatAmount(result.balance_after)}</b> HTB</> });
      back();
      setId(newId());
      today.refetch();
    } catch (e) {
      setError(failure(e).problem);
    } finally {
      setBusy(false);
    }
  }

  if (picked) {
    const ready = !!reason && (reason !== '其他' || !!other.trim());
    return (
      <>
        <div className="dc-split">
          <section className="dc-card dc-enter">
            <h2 className="heading" style={{ marginBottom: 'var(--space-2)' }}>要冲正的业务</h2>
            <Summary rows={[
              ['业务', describe(picked)],
              ['学生', `${picked.students.name} · ${classOf(picked.students)} · 学号 ${picked.student_no}`],
              ...(picked.denominations ? [[picked.type === 'purchase' ? '收到现金' : '面额', describeCash(picked.denominations)] as [string, string]] : []),
              ['办理时间', formatTime(picked.created_at)],
              ['交易号', picked.txn_no],
            ]} />
          </section>
          <section className="dc-stack">
            <fieldset className="dc-check-group">
              <legend>冲正原因</legend>
              {REASONS.map((r) => (
                <label key={r} className="dc-check">
                  <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
                  <span className="dc-radio-dot" />{r}
                </label>
              ))}
            </fieldset>
            {reason === '其他' && (
              <label className="dc-field">
                <span className="dc-field-label"><Icon name="help" />说明</span>
                <span className="dc-input-wrap">
                  <input className="dc-input" autoFocus value={other} maxLength={60} placeholder="写清楚冲正的原因"
                    onChange={(e) => setOther(e.target.value)} />
                </span>
              </label>
            )}
          </section>
        </div>
        {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
        <div className="dc-actions">
          <button className="dc-btn dc-btn-secondary" type="button" onClick={back}>返回列表</button>
          <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button" disabled={!busy && !ready}
            onClick={() => setConfirming(true)}>
            {busy ? '正在冲正' : ready ? '确认冲正' : '请选择冲正原因'}
          </button>
        </div>
        {confirming && (
          <ConfirmSheet title="确认冲正" confirm="确认冲正" onClose={() => setConfirming(false)} onConfirm={submit}
            text={<>冲正 <b>{picked.students.name}</b> 的{describe(picked)}（{picked.txn_no}），原因：{fullReason}。冲正后不能撤销。</>} />
        )}
      </>
    );
  }

  const q = search.trim();
  const list = (today.data ?? []).filter((t) => student ? t.student_no === student.student_no
    : !q || t.txn_no.includes(q.toUpperCase()) || t.student_no.includes(q));
  return (
    <>
      {!student && (
        <label className="dc-search">
          <Icon name="query" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="输入交易号或学号" aria-label="查找业务" />
        </label>
      )}
      <h2 className="heading">{student ? `今天我为${student.name}办理的业务` : '今天我办理的业务'}</h2>
      {today.error ? <Notice tone="danger" title="暂时无法读取业务">请检查网络后重试。</Notice>
        : !today.data ? null
        : list.length ? (
          <ul className="dc-list dc-stagger">
            {list.map((t) => (
              <li key={t.id}>
                <a className="dc-list-link" href="#" role="button" onClick={(e) => { e.preventDefault(); setPicked(t); }}>
                  <span className="dc-list-icon"><Icon name={t.type === 'purchase' ? 'exchange' : t.type} /></span>
                  <span>{student ? '' : `${t.students.name} · `}{describe(t)}<small className="dc-top-sub">{t.txn_no} · {formatTime(t.created_at)}</small></span>
                  <Icon name="next" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="dc-card">
            <div className="dc-empty">
              <span className="dc-empty-icon"><Icon name="inbox" /></span>
              <h3>{q && !student ? '没有找到这笔业务' : '今天还没有可冲正的业务'}</h3>
              <p>只能冲正本人今天办理、还没冲正过的存款、取款和兑换。</p>
            </div>
          </div>
        )}
      {onEnd && (
        <div className="dc-actions">
          <button className="dc-btn dc-btn-secondary" type="button" onClick={onEnd}>结束办理</button>
        </div>
      )}
    </>
  );
}
