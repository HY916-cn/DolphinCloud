import { useQuery } from '@tanstack/react-query';
import { Desk, Icon, link, ListLoading, Notice } from '@/components';
import { formatAmount } from '@/lib/format';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type Row = { id: string; name: string; price: number; stock: number; listed: boolean; image_path: string | null };
const imageUrl = (path: string) => supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;

// 商品: every product, listed ones first, those out of stock marked 缺货; a row opens the product to edit it, 出入库
// stocks several in or out at once (PHASE-1.md §1.1). The accountant only reads them, with their cost.
export default function Products() {
  const editor = useMe().data!.roles.some((r) => r === 'storekeeper' || r === 'teacher');
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
    <Desk title="商品">
      <div className="dc-section-head">
        <p className="dc-top-sub">{products.data && `共 ${products.data.length} 件商品，${products.data.filter((p) => p.listed).length} 件已上架`}</p>
        {editor && (
          <span style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <a className="dc-btn dc-btn-secondary dc-btn-sm" {...link('/admin/stock')}><Icon name="inbox" />出入库</a>
            <a className="dc-btn dc-btn-primary dc-btn-sm" {...link('/admin/products/new')}><Icon name="plus" />新增商品</a>
          </span>
        )}
      </div>
      {products.error ? <Notice tone="danger" title="暂时无法读取商品">请检查网络后刷新页面。</Notice>
        : !products.data ? <ListLoading label="正在加载商品" />
        : !products.data.length ? (
          <div className="dc-card">
            <div className="dc-empty">
              <span className="dc-empty-icon dc-kind-exchange"><Icon name="exchange" /></span>
              <h3>还没有商品</h3>
              <p>{editor ? '新增商品并上架后，柜台就可以办理兑换。' : '库管新增商品后，这里会列出商品和成本。'}</p>
            </div>
          </div>
        ) : (
          <ul className="dc-list dc-enter" aria-label="商品">
            {products.data.map((p) => (
              <li key={p.id}>
                <a className="dc-list-link dc-kind-exchange" {...link(`/admin/products/${p.id}`)}>
                  <span className="dc-list-icon" style={{ overflow: 'hidden' }}>
                    {p.image_path ? <img src={imageUrl(p.image_path)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <Icon name="exchange" />}
                  </span>
                  <span>
                    {p.name}
                    {p.stock === 0 && <> <span className="dc-tag dc-tag-danger"><Icon name="warning" />缺货</span></>}
                    <small className="dc-top-sub">价格 {formatAmount(p.price)} HTB · 库存 {p.stock}</small>
                  </span>
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
