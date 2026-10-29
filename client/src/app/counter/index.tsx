import { useQuery } from '@tanstack/react-query';
import { CounterPage, Icon, KvLoading, link, Summary, type IconName } from '@/components';
import { formatAmount } from '@/lib/format';
import { useOnline } from '@/lib/online';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const BUSINESSES: { href: string; icon: IconName; label: string; kind?: string }[] = [
  { href: '/counter/serve?b=deposit', icon: 'deposit', label: '存款', kind: 'dc-kind-save' },
  { href: '/counter/serve?b=withdraw', icon: 'withdraw', label: '取款', kind: 'dc-kind-withdraw' },
  { href: '/counter/serve?b=shop', icon: 'exchange', label: '兑换', kind: 'dc-kind-exchange' },
  { href: '/counter/reversal', icon: 'transfer', label: '冲正' },
];
const KINDS = [['deposit', '存款'], ['withdraw', '取款'], ['purchase', '兑换']] as const;

// 总览: the counter's businesses (each opens 办理 on its tab; one student can then have several) and what this
// teller has done today (RLS shows a teller only their own day).
export default function Overview() {
  const me = useMe().data!;
  const online = useOnline();
  const today = useQuery({
    queryKey: ['my-day', me.profile.id],
    enabled: online,
    queryFn: async () => {
      const { data, error } = await supabase.from('txns').select('type,amount')
        .eq('operator_id', me.profile.id).eq('status', 'normal').in('type', ['deposit', 'withdraw', 'purchase']);
      if (error) throw error;
      return data as { type: string; amount: number }[];
    },
  });
  const rows = KINDS.map(([type, label]): [string, string] => {
    const of = (today.data ?? []).filter((t) => t.type === type);
    return [label, `${of.length} 笔 · ${formatAmount(of.reduce((s, t) => s + t.amount, 0))} HTB`];
  });

  return (
    <CounterPage title="总览">
      <div className="dc-tiles dc-enter">
        {BUSINESSES.map((b) => (
          <a key={b.href} className={`dc-tile ${b.kind ?? ''}`} {...link(b.href)}><span className="dc-tile-icon"><Icon name={b.icon} /></span>{b.label}</a>
        ))}
      </div>
      <section className="dc-card dc-enter" style={{ '--i': 1 } as React.CSSProperties}>
        <h2 className="heading" style={{ marginBottom: 'var(--space-2)' }}>今天我办理的业务</h2>
        {!online ? <p className="dc-top-sub">联网后显示今日统计。</p>
          : today.isError ? <p className="dc-top-sub">暂时读不到今日统计，请稍后再看。</p>
          : today.isPending ? <KvLoading rows={rows.length} card={false} />
          : <Summary rows={rows} />}
      </section>
    </CounterPage>
  );
}
