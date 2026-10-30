import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Desk, FormLoading, SkeletonGroup, Icon, Notice, TxnListLoading, type IconName } from '@/components';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatSigned, formatTime } from '@/lib/format';
import { call } from '@/lib/rpc';
import { supabase } from '@/lib/supabase';

type Product = {
  id: string; name: string; price: number; cost: number | null; category: string | null;
  image_path: string | null; listed: boolean; stock: number;
};
type Move = { id: number; kind: 'stock_in' | 'sale' | 'reversal'; qty_delta: number; note: string | null; created_at: string };
type Problem = { title: string; text: string } | null;

const imageUrl = (path: string) => supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
const failure = (e: unknown) => (e instanceof AppError ? explain(e.code, e.detail) : explain(''));
const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
const MOVE: Record<Move['kind'], { label: string; icon: IconName; kind: string }> = {
  stock_in: { label: '入库', icon: 'plus', kind: '' }, sale: { label: '兑换', icon: 'exchange', kind: 'dc-kind-exchange' },
  reversal: { label: '冲正', icon: 'transfer', kind: '' },
};

// Scales a picture to at most 800px on its longest side as a JPEG at quality 0.8 (PHASE-1.md §6.7), on a white ground
// so transparent PNGs do not turn black.
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', 0.8));
}

function Field({ icon, label, error, hint, children }: { icon: IconName; label: string; error?: string | null; hint?: string; children: ReactNode }) {
  return (
    <label className={`dc-field ${error ? 'is-error' : ''}`}>
      <span className="dc-field-label"><Icon name={icon} />{label}</span>
      <span className="dc-input-wrap">{children}</span>
      {(error || hint) && <span className="dc-field-hint">{error ? <><Icon name="warning" />{error}</> : hint}</span>}
    </label>
  );
}

// 新增商品 (id "new") or 编辑商品 with 入库 and the latest stock movements.
export default function ProductPage() {
  const { id, saved } = useLocalSearchParams<{ id: string; saved?: string }>();
  const isNew = id === 'new';
  const product = useQuery({
    queryKey: ['products', id],
    enabled: !isNew,
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('id,name,price,cost,category,image_path,listed,stock')
        .eq('id', id).maybeSingle();
      if (error) throw error;
      return data as Product | null;
    },
  });
  const back = () => router.navigate('/admin/products' as Href);
  return (
    <Desk title={isNew ? '新增商品' : '编辑商品'} back={back}>
      {isNew ? <ProductForm product={null} /> : product.error ? <Notice tone="danger" title="暂时无法读取商品">请检查网络后刷新页面。</Notice>
        : product.isPending ? <SkeletonGroup className="dc-split"><FormLoading fields={5} /><FormLoading fields={2} /></SkeletonGroup>
        : !product.data ? <Notice tone="danger" title="未找到这件商品">请返回商品列表重新选择。</Notice>
        : (
          <div className="dc-split">
            <ProductForm key={product.data.id} product={product.data} savedBefore={!!saved} />
            <StockIn product={product.data} />
          </div>
        )}
    </Desk>
  );
}

function ProductForm({ product, savedBefore = false }: { product: Product | null; savedBefore?: boolean }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(product?.name ?? '');
  const [price, setPrice] = useState(product ? String(product.price) : '');
  const [cost, setCost] = useState(product?.cost == null ? '' : String(product.cost));
  const [category, setCategory] = useState(product?.category ?? '');
  const [listed, setListed] = useState(product?.listed ?? false);
  const [imagePath, setImagePath] = useState(product?.image_path ?? null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(savedBefore);
  const [error, setError] = useState<Problem>(null);

  // The same rules as upsert_product: a name, a whole price above 0, a cost of 0 or more (the inputs take digits only).
  const nameProblem = tried && !name.trim() ? '请输入商品名称' : null;
  const priceProblem = tried && !(Number(price) > 0) ? '请输入大于 0 的整数价格' : null;

  async function pick(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      let blob: Blob;
      try {
        blob = await shrink(file);
      } catch {
        return setError({ title: '无法读取这张图片', text: '请换一张 JPG 或 PNG 图片。' });
      }
      const path = `${crypto.randomUUID()}.jpg`;
      const { error: e } = await supabase.storage.from('product-images').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (e) return setError({ title: '图片未能上传', text: '请检查网络后重新选择图片。' });
      setImagePath(path);
    } finally {
      setUploading(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (busy || uploading || !name.trim() || !(Number(price) > 0)) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const row = await call<Product>('upsert_product', {
        p_id: product?.id ?? null, p_name: name.trim(), p_price: Number(price), p_cost: cost ? Number(cost) : null,
        p_category: category.trim() || null, p_image_path: imagePath, p_listed: listed,
      });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      if (!product) return router.replace(`/admin/products/${row.id}?saved=1` as Href);
      setSaved(true);
    } catch (err) {
      setError(failure(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="dc-card dc-stack" onSubmit={save} noValidate aria-label="商品信息">
      <h2 className="heading">商品信息</h2>
      <Field icon="exchange" label="商品名称" error={nameProblem}>
        <input className="dc-input" value={name} maxLength={40} placeholder="例如 海豚书签" onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field icon="coin" label="价格" error={priceProblem} hint="兑换一件所需的海豚币，整数">
        <input className="dc-input" inputMode="numeric" value={price} placeholder="请输入价格" onChange={(e) => setPrice(digits(e.target.value))} />
        <span className="dc-input-unit">HTB</span>
      </Field>
      <Field icon="savings" label="成本" hint="选填，用于核算">
        <input className="dc-input" inputMode="numeric" value={cost} placeholder="选填" onChange={(e) => setCost(digits(e.target.value))} />
        <span className="dc-input-unit">HTB</span>
      </Field>
      <Field icon="passbook" label="分类" hint="选填，柜台按分类排列商品">
        <input className="dc-input" value={category} maxLength={20} placeholder="例如 文具" onChange={(e) => setCategory(e.target.value)} />
      </Field>
      <div className="dc-field">
        <span className="dc-field-label"><Icon name="star" />商品图片</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <span className="dc-tile-icon dc-kind-exchange" style={{ width: 96, height: 96, overflow: 'hidden', flex: 'none' }}>
            {imagePath ? <img src={imageUrl(imagePath)} alt="商品图片预览" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <Icon name="exchange" />}
          </span>
          <button type="button" className={`dc-btn dc-btn-secondary dc-btn-sm ${uploading ? 'is-loading' : ''}`}
            onClick={() => fileInput.current?.click()}>
            {uploading ? '正在上传' : imagePath ? '更换图片' : '选择图片'}
          </button>
          <input ref={fileInput} type="file" accept="image/*" hidden aria-label="选择商品图片"
            onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <span className="dc-field-hint">上传前自动缩小到最长边 800 像素</span>
      </div>
      <label className="dc-switch">
        <span className="dc-switch-text"><b>上架</b><small>上架后柜台可以兑换这件商品，保存后生效</small></span>
        <input type="checkbox" role="switch" checked={listed} onChange={(e) => setListed(e.target.checked)} />
        <span className="dc-switch-track" />
      </label>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      {saved && !error && <Notice tone="success" title="商品已保存">{listed ? '商品已上架，柜台可以兑换。' : '商品已下架，柜台不再显示。'}</Notice>}
      <div>
        <button className={`dc-btn dc-btn-primary dc-btn-sm ${busy ? 'is-loading' : ''}`} type="submit" disabled={uploading}>
          {busy ? '正在保存' : '保存商品'}
        </button>
      </div>
    </form>
  );
}

function StockIn({ product }: { product: Product }) {
  const queryClient = useQueryClient();
  const moves = useQuery({
    queryKey: ['stock_movements', product.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_movements').select('id,kind,qty_delta,note,created_at')
        .eq('product_id', product.id).order('created_at', { ascending: false }).limit(10);
      if (error) throw error;
      return data as Move[];
    },
  });
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<Problem>(null);
  const qtyProblem = tried && !(Number(qty) > 0) ? '请输入大于 0 的入库数量' : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (busy || !(Number(qty) > 0)) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await call('stock_in', { p_product_id: product.id, p_qty: Number(qty), p_note: note.trim() || null });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['stock_movements', product.id] }),
      ]);
      setDone(Number(qty));
      setQty('');
      setNote('');
      setTried(false);
    } catch (err) {
      setError(failure(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dc-stack">
      <form className="dc-card dc-stack" onSubmit={submit} noValidate aria-label="入库">
        <h2 className="heading">入库</h2>
        <dl className="dc-kv" aria-live="polite">
          <div className="is-total"><dt>当前库存</dt><dd>{formatAmount(product.stock)}<small>件</small></dd></div>
        </dl>
        <Field icon="plus" label="入库数量" error={qtyProblem}>
          <input className="dc-input" inputMode="numeric" value={qty} placeholder="请输入数量" onChange={(e) => setQty(digits(e.target.value))} />
          <span className="dc-input-unit">件</span>
        </Field>
        <Field icon="passbook" label="备注" hint="选填，例如进货批次">
          <input className="dc-input" value={note} maxLength={60} placeholder="选填" onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
        {done !== null && !error && <Notice tone="success" title="入库成功">已入库 {done} 件，当前库存 {product.stock} 件。</Notice>}
        <div>
          <button className={`dc-btn dc-btn-primary dc-btn-sm ${busy ? 'is-loading' : ''}`} type="submit">{busy ? '正在入库' : '确认入库'}</button>
        </div>
      </form>
      <h2 className="heading">库存变动</h2>
      {moves.error ? <Notice tone="danger" title="暂时无法读取库存变动">请检查网络后刷新页面。</Notice>
        : !moves.data ? <TxnListLoading label="正在加载库存变动" />
        : !moves.data.length ? <p className="dc-top-sub">还没有库存变动。</p>
        : (
          <ul className="dc-txns" aria-label="最近 10 条库存变动">
            {moves.data.map((m) => (
              <li key={m.id} className={`dc-txn ${MOVE[m.kind].kind}`}>
                <span className="dc-txn-icon"><Icon name={MOVE[m.kind].icon} /></span>
                <div className="dc-txn-main">
                  <div className="dc-txn-title">{[MOVE[m.kind].label, m.note].filter(Boolean).join(' · ')}</div>
                  <div className="dc-txn-time">{formatTime(m.created_at)}</div>
                </div>
                <div className={`dc-txn-amount ${m.qty_delta > 0 ? 'is-in' : ''}`}>{formatSigned(m.qty_delta)}<small>件</small></div>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
