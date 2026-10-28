import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CashCounter, ConfirmSheet, CounterPage, FindStudent, Icon, NeedsNetwork, Notice, PersonCard, ResultView, Steps, Summary } from '@/components';
import { cashTotal, describeCash, makeChange, nonEmpty, type Counts } from '@/lib/cash';
import { classOf, newId, purchase, useSettings, type Student, type TxnResult } from '@/lib/counter';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatTime } from '@/lib/format';
import { useOnline } from '@/lib/online';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const STEPS = ['识别学生', '选择商品', '核对信息', '完成'];
type Product = { id: string; name: string; price: number; stock: number; image_path: string | null };

const imageUrl = (path: string) => supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;

// 兑换 (PHASE-1.md §7.5): pick products, then pay from the account or in cash with change worked out.
export default function Shop() {
  const me = useMe().data!;
  const online = useOnline();
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
  const [student, setStudent] = useState<Student | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [payment, setPayment] = useState<'account' | 'cash'>('account');
  const [received, setReceived] = useState<Counts>({});
  const [id, setId] = useState(newId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const [done, setDone] = useState<TxnResult | null>(null);

  const list = products.data ?? [];
  const lines = list.filter((p) => cart[p.id]).map((p) => ({ ...p, qty: cart[p.id] }));
  const due = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const paid = cashTotal(received);
  const change = Math.max(paid - due, 0);
  const setQty = (p: Product, n: number) => setCart({ ...cart, [p.id]: Math.max(0, Math.min(p.stock, n)) });

  function reset() {
    setStudent(null);
    setCart({});
    setPayment('account');
    setReceived({});
    setId(newId());
    setError(null);
    setDone(null);
    products.refetch();
  }

  async function submit() {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      setDone(await purchase(id, student!.student_no, lines.map((l) => ({ product_id: l.id, qty: l.qty })), payment,
        payment === 'cash' ? nonEmpty(received) : undefined));
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('');
      setError(explain(err.code, err.detail));
      if (err.code === 'OUT_OF_STOCK' || err.code === 'PRODUCT_UNLISTED') products.refetch();
    } finally {
      setBusy(false);
    }
  }

  if (!online && !done) {
    return (
      <CounterPage title="兑换">
        <NeedsNetwork business="兑换" />
      </CounterPage>
    );
  }

  const items = lines.map((l) => `${l.name} × ${l.qty}`).join('、');
  if (done) {
    return (
      <CounterPage title="兑换">
        <Steps names={STEPS} current={3} />
        <ResultView title="兑换成功" onNext={reset}
          lead={payment === 'account'
            ? <>账户支付 <b>{formatAmount(done.amount)} HTB</b>，当前余额 <b>{formatAmount(done.balance_after)}</b> HTB</>
            : <>现金收款 <b>{formatAmount(paid)} HTB</b>，找零 <b>{formatAmount(change)}</b> HTB</>}
          rows={[
            ['学生', `${student!.name} · ${classOf(student!)}`],
            ['商品', items],
            ...(payment === 'cash' ? [['找零', describeCash(done.change_given ?? {}) || '不用找零'] as [string, string]] : []),
            ['经办柜员', me.profile.display_name],
            ['办理时间', formatTime(done.created_at)],
            ['交易号', done.txn_no],
          ]} />
      </CounterPage>
    );
  }

  if (!student) {
    return (
      <CounterPage title="兑换">
        <Steps names={STEPS} current={0} />
        <FindStudent onFound={setStudent} />
      </CounterPage>
    );
  }

  const balance = student.balance ?? 0;
  const problem =
    !lines.length ? '请选择商品'
    : payment === 'account' && due > balance ? `余额不足，还差 ${formatAmount(due - balance)} HTB`
    : payment === 'cash' && paid < due ? `收款不足，还差 ${formatAmount(due - paid)} HTB`
    : null;

  return (
    <CounterPage title="兑换" onBack={reset}>
      <Steps names={STEPS} current={confirming ? 2 : 1} />
      <div className="dc-split">
        <section className="dc-stack">
          <PersonCard student={student} />
          <h2 className="heading" style={{ margin: 'var(--space-2) 0 0' }}>选择商品</h2>
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
              <h2 className="heading" style={{ margin: 'var(--space-2) 0 0' }}>已选商品</h2>
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
              <h2 className="heading" style={{ margin: 'var(--space-2) 0 0' }}>付款方式</h2>
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
                  <h2 className="heading" style={{ margin: 'var(--space-2) 0 0' }}>录入收到的现金</h2>
                  <CashCounter faces={denominations} counts={received} onChange={setReceived} />
                </>
              )}
            </>
          )}
        </section>
        <aside className="dc-card is-sticky dc-hide-phone">
          <h2 className="heading" style={{ margin: '0 0 var(--space-2)' }}>核对金额</h2>
          <Summary rows={[
            ...lines.map((l): [string, string] => [`${l.name} × ${l.qty}`, formatAmount(l.price * l.qty)]),
            ...(payment === 'account'
              ? [['支付后余额', `${formatAmount(Math.max(balance - due, 0))} HTB`] as [string, string]]
              : [['已收现金', `${formatAmount(paid)} HTB`], ['找零', change ? describeCash(makeChange(change, denominations)) : '—']] as [string, string][]),
          ]} total={['应付', due]} />
        </aside>
      </div>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <div className="dc-actions">
        <button className="dc-btn dc-btn-secondary dc-hide-phone" type="button" onClick={reset}>上一步</button>
        <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button" disabled={!busy && !!problem}
          onClick={() => setConfirming(true)}>
          {busy ? '正在兑换' : problem ?? '确认兑换'}
        </button>
        <div className="dc-actions-total">
          <span>应付{payment === 'cash' && change > 0 && <small>找零 {formatAmount(change)} HTB</small>}</span>
          <b>{formatAmount(due)}<small>HTB</small></b>
        </div>
      </div>
      {confirming && (
        <ConfirmSheet title="确认兑换" confirm="确认兑换" onClose={() => setConfirming(false)} onConfirm={submit}
          text={payment === 'account'
            ? <>为 <b>{student.name}</b> 兑换 {items}，账户扣款 <b>{formatAmount(due)} HTB</b></>
            : <>为 <b>{student.name}</b> 兑换 {items}，现金收 <b>{formatAmount(paid)} HTB</b>{change ? `，找零 ${describeCash(makeChange(change, denominations))}` : ''}</>} />
      )}
    </CounterPage>
  );
}
