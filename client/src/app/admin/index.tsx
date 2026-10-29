import { useQuery } from '@tanstack/react-query';
import { Desk, Icon, link, Notice, sectionsFor } from '@/components';
import { formatTime } from '@/lib/format';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';

// 总览: the sections this login may open. Teachers also see the last ledger check that found a difference (§9.4).
export default function Admin() {
  const me = useMe().data!;
  const teacher = me.roles.includes('teacher');
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
  return (
    <Desk title="总览">
      {mismatch.data && (
        <Notice tone="danger" title="余额自检发现不一致">
          {formatTime(mismatch.data.at)} 的自检有 {mismatch.data.after.length} 处余额或库存与流水不符，请在服务器上运行 dolphin check 核对。
        </Notice>
      )}
      <div className="dc-tiles dc-enter">
        {sectionsFor(me).map((s) => (
          <a key={s.href} className={`dc-tile ${s.kind ?? ''}`} {...link(s.href)}><span className="dc-tile-icon"><Icon name={s.icon} /></span>{s.label}</a>
        ))}
      </div>
    </Desk>
  );
}
