import { useQuery } from '@tanstack/react-query';
import { Desk, Icon, link, Notice } from '@/components';
import { formatAmount } from '@/lib/format';
import { supabase } from '@/lib/supabase';

type Row = { id: string; name: string; price: number; stock: number; listed: boolean; image_path: string | null };
const imageUrl = (path: string) => supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;

// 商品: every product, listed ones first; a row opens the product to edit it or stock it in (PHASE-1.md §1.1).
export default function Products() {
  const products = useQuery({
    queryKey: ['products', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('id,name,price,stock,listed,image_path')
        .order('listed', { ascending: false }).order('name');
      if (error) throw error;
      return data as Row[];
    },
  });
  return (
    <Desk title="商品" actions={
      <a className="dc-btn dc-btn-primary dc-btn-sm" {...link('/admin/products/new')}><Icon name="plus" />新增商品</a>
    }>
      {products.error ? <Notice tone="danger" title="暂时无法读取商品">请检查网络后刷新页面。</Notice>
        : !products.data ? <span className="dc-skeleton" style={{ height: 240, borderRadius: 'var(--radius-lg)' }} />
        : !products.data.length ? (
          <div className="dc-card">
            <div className="dc-empty">
              <span className="dc-empty-icon"><Icon name="inbox" /></span>
              <h3>还没有商品</h3>
              <p>新增商品并上架后，柜台就可以办理兑换。</p>
              <a className="dc-btn dc-btn-secondary dc-btn-sm" {...link('/admin/products/new')}>新增商品</a>
            </div>
          </div>
        ) : (
          <ul className="dc-list dc-enter" aria-label="商品">
            {products.data.map((p) => (
              <li key={p.id}>
                <a className="dc-list-link" {...link(`/admin/products/${p.id}`)}>
                  <span className="dc-list-icon" style={{ overflow: 'hidden' }}>
                    {p.image_path ? <img src={imageUrl(p.image_path)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <Icon name="exchange" />}
                  </span>
                  <span>{p.name}<small className="dc-top-sub">价格 {formatAmount(p.price)} HTB · 库存 {p.stock}</small></span>
                  <span className={`dc-tag ${p.listed ? '' : 'dc-tag-danger'}`} style={{ flex: 'none' }}>
                    <Icon name={p.listed ? 'check' : 'warning'} />{p.listed ? '已上架' : '已下架'}
                  </span>
                  <Icon name="next" />
                </a>
              </li>
            ))}
          </ul>
        )}
    </Desk>
  );
}
