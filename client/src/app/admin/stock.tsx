import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Desk, Icon, link, ListLoading, MoveList, Notice, TxnListLoading, type Move } from '@/components';
import { AppError, explain } from '@/lib/errors';
import { formatAmount } from '@/lib/format';
import { call } from '@/lib/rpc';
import { supabase } from '@/lib/supabase';

type Product = { id: string; name: string; stock: number; listed: boolean };
type Kind = 'stock_in' | 'stock_out';
type Problem = { title: string; text: string } | null;

const failure = (e: unknown) => (e instanceof AppError ? explain(e.code, e.detail) : explain(''));
const KIND = {
  stock_in: { label: '入库', hue: 'dc-kind-save', note: '备注', hint: '选填，例如进货批次' },
  stock_out: { label: '出库', hue: 'dc-kind-withdraw', note: '出库原因', hint: '必填，例如损坏、赠送、盘点短少' },
} as const;

// 出入库 (storekeeper, teacher): stock in or take out several products in one go with the counter's steppers, and the
// latest movements of every product (PHASE-1.md §7.9).
export default function Stock() {
  const queryClient = useQueryClient();
  const products = useQuery({
    queryKey: ['products', 'stock'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('id,name,stock,listed').order('listed', { ascending: false }).order('name');
      if (error) throw error;
      return data as Product[];
    },
  });
  const moves = useQuery({
    queryKey: ['stock_movements', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_movements').select('id,kind,qty_delta,note,created_at,products(name)')
        .order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      return data as unknown as Move[];
    },
  });
  const [kind, setKind] = useState<Kind>('stock_in');
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ kind: Kind; count: number; qty: number } | null>(null);
  const [error, setError] = useState<Problem>(null);

  const out = kind === 'stock_out';
  const max = (p: Product) => (out ? p.stock : 999_999);
  const setQty = (p: Product, n: number) => setQtys({ ...qtys, [p.id]: Math.max(0, Math.min(max(p), n)) });
  const lines = (products.data ?? []).filter((p) => qtys[p.id] > 0);
  const total = lines.reduce((s, p) => s + qtys[p.id], 0);
  const noteProblem = tried && out && !note.trim() ? '请写明出库原因' : null;

  function switchKind(k: Kind) {
    setKind(k);
    setQtys({});
    setTried(false);
    setError(null);
    setDone(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (busy || !lines.length || (out && !note.trim())) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await call<{ count: number; qty: number }>('stock_move', {
        p_kind: kind, p_items: lines.map((p) => ({ product_id: p.id, qty: qtys[p.id] })), p_note: note.trim() || null,
      });
      setDone({ kind, ...r });
      setQtys({});
      setNote('');
      setTried(false);
    } catch (err) {
      setError(failure(err));
    } finally {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['stock_movements'] }),
      ]);
      setBusy(false);
    }
  }

  return (
    <Desk title="出入库">
      <div className="dc-split">
        <form className="dc-card dc-stack dc-enter" onSubmit={submit} noValidate aria-label="出入库">
          <fieldset className="dc-seg" aria-label="类型">
            {(['stock_in', 'stock_out'] as const).map((k) => (
              <label key={k}>
                <input type="radio" name="stock-kind" checked={kind === k} onChange={() => switchKind(k)} />
                <span><Icon name={k === 'stock_in' ? 'plus' : 'minus'} />{KIND[k].label}</span>
              </label>
            ))}
          </fieldset>
          {done && <Notice tone="success" title={`${KIND[done.kind].label}成功`}>已{KIND[done.kind].label} {done.count} 种商品，共 {formatAmount(done.qty)} 件。</Notice>}
          {products.error ? <Notice tone="danger" title="暂时无法读取商品">请检查网络后刷新页面。</Notice>
            : !products.data ? <ListLoading rows={3} label="正在加载商品" />
            : !products.data.length ? (
              <div className="dc-empty">
                <span className="dc-empty-icon dc-kind-exchange"><Icon name="exchange" /></span>
                <h3>还没有商品</h3>
                <p>先在「商品」里新增商品，再来入库。</p>
                <a className="dc-btn dc-btn-secondary dc-btn-sm" {...link('/admin/products/new')}><Icon name="plus" />新增商品</a>
              </div>
            ) : (
              <div className={`dc-denoms ${KIND[kind].hue}`} role="group" aria-label={`${KIND[kind].label}数量`}>
                {products.data.map((p) => {
                  const n = qtys[p.id] ?? 0;
                  return (
                    <div key={p.id} className={`dc-qty ${n ? 'is-filled' : ''}`}>
                      <div className="dc-qty-head">
                        <span className="dc-qty-face" style={{ fontSize: 18, minWidth: 0, overflowWrap: 'anywhere' }}>{p.name}</span>
                        <span className="dc-qty-sum" style={{ flex: 'none' }}>库存<b>{formatAmount(p.stock)}</b></span>
                      </div>
                      <div className="dc-qty-ctrl">
                        <button className="dc-qty-btn" type="button" aria-label={`减少一件${p.name}`} disabled={!n} onClick={() => setQty(p, n - 1)}><Icon name="minus" /></button>
                        <input className="dc-qty-input" inputMode="numeric" aria-label={`${p.name}${KIND[kind].label}数量`} value={n}
                          onChange={(e) => setQty(p, Number(e.target.value.replace(/\D/g, '').slice(0, 6)))} />
                        <button className="dc-qty-btn" type="button" aria-label={`增加一件${p.name}`} disabled={n >= max(p)} onClick={() => setQty(p, n + 1)}><Icon name="plus" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          <label className={`dc-field ${noteProblem ? 'is-error' : ''}`}>
            <span className="dc-field-label"><Icon name="passbook" />{KIND[kind].note}</span>
            <span className="dc-input-wrap">
              <input className="dc-input" value={note} maxLength={60} placeholder={out ? '请输入出库原因' : '选填'} onChange={(e) => setNote(e.target.value)} />
            </span>
            <span className="dc-field-hint">{noteProblem ? <><Icon name="warning" />{noteProblem}</> : KIND[kind].hint}</span>
          </label>
          <dl className="dc-kv" aria-live="polite">
            {lines.map((p) => <div key={p.id}><dt>{p.name}</dt><dd>{out ? '−' : '+'}{formatAmount(qtys[p.id])} 件</dd></div>)}
            <div className="is-total"><dt>{KIND[kind].label}合计</dt><dd>{formatAmount(total)}<small>件</small></dd></div>
          </dl>
          {tried && !lines.length && <Notice tone="danger" title="还没有选择商品">请用加减按钮填写要{KIND[kind].label}的数量。</Notice>}
          {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
          <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="submit">
            {busy ? `正在${KIND[kind].label}` : `确认${KIND[kind].label}`}
          </button>
        </form>
        <section className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties} aria-label="最近库存变动">
          <p className="dc-list-title">最近库存变动</p>
          {moves.error ? <Notice tone="danger" title="暂时无法读取库存变动">请检查网络后刷新页面。</Notice>
            : !moves.data ? <TxnListLoading label="正在加载库存变动" />
            : !moves.data.length ? <div className="dc-card"><p className="dc-top-sub">还没有库存变动。</p></div>
            : <MoveList moves={moves.data} label="最近 20 条库存变动" />}
        </section>
      </div>
    </Desk>
  );
}
