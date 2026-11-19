import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { AlertRow, Desk, FilterBar, Icon, ListLoading, NO_FILTER, Notice, Toast, useAlertOverview } from '@/components';
import { alertDay, alertsHref, KIND_CHIPS, type Alert, type AlertStatus } from '@/lib/alerts';
import { call } from '@/lib/rpc';

type Tab = AlertStatus | 'all';
const TABS: [Tab, string][] = [['open', '未处理'], ['seen', '已查看'], ['terminated', '已终止'], ['all', '全部']];
const PAGE = 50;

// 风险提醒 (PHASE-2.md §12, design system RiskAlerts; president, bank admin): the alerts newest first, by day, kind and
// status (未处理 by default), 50 at a time. The filters live in the address, so an alert's page returns to them.
// `?fresh=<id>` is the alert just handled: it stays in the list, marked new, with the Toast.
export default function Alerts() {
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ tab?: Tab; from?: string; to?: string; kinds?: string; fresh?: string }>();
  const filters = { tab: params.tab, from: params.from, to: params.to, kinds: params.kinds };
  const tab = params.tab ?? 'open';
  const kinds = params.kinds ? params.kinds.split(',') : [];
  const overview = useAlertOverview();
  const list = useInfiniteQuery({
    queryKey: ['risk-alerts', 'list', tab, params.from ?? '', params.to ?? '', params.kinds ?? ''],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => call<Alert[]>('list_risk_alerts', {
      p_status: tab === 'all' ? null : [tab], p_kind: kinds.length ? kinds : null, p_from: params.from || null, p_to: params.to || null,
      p_before: pageParam, p_limit: PAGE,
    }),
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].id : undefined),
  });
  const [fresh, setFresh] = useState(() => (params.fresh ? queryClient.getQueryData<Alert | null>(['risk-alert', params.fresh]) ?? null : null));
  const [toast, setToast] = useState(() => (fresh ? (fresh.status === 'terminated' ? '已终止' : '已标为已查看') : null));
  useEffect(() => { if (params.fresh) router.setParams({ fresh: undefined }); }, [params.fresh]);
  const filter = (p: Partial<typeof filters>) => {
    setFresh(null);
    router.setParams(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v || undefined])));
  };

  const loaded = list.data?.pages.flat() ?? [];
  const rows = fresh && !loaded.some((a) => a.id === fresh.id) ? [...loaded, fresh].sort((a, b) => b.id - a.id) : loaded;
  const days: { key: string; title: string; alerts: Alert[] }[] = [];
  for (const a of rows) {
    const day = alertDay(a.at);
    if (days.at(-1)?.key !== day.key) days.push({ ...day, alerts: [] });
    days.at(-1)!.alerts.push(a);
  }

  return (
    <Desk title="风险提醒">
      <div className="dc-stack dc-enter">
        <FilterBar label="筛选风险提醒" search={false} times={false} kinds={KIND_CHIPS}
          value={{ ...NO_FILTER, from: params.from ?? '', to: params.to ?? '', kinds }}
          onChange={(f) => filter({ from: f.from, to: f.to, kinds: f.kinds.join(',') })} />
        <div className="dc-tabs" role="tablist" aria-label="状态">
          {TABS.map(([k, label]) => (
            <button key={k} id={`alerts-tab-${k}`} className="dc-tabs-item" role="tab" type="button" aria-selected={tab === k} aria-controls="alerts-panel"
              onClick={() => filter({ tab: k === 'open' ? undefined : k })}>
              {label}{k === 'open' && overview.data && <span className="dc-count">{overview.data.open}</span>}
            </button>
          ))}
        </div>
      </div>
      <section id="alerts-panel" className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties} role="tabpanel" aria-labelledby={`alerts-tab-${tab}`}>
        {list.isError ? <Notice tone="danger" title="暂时无法读取风险提醒">请检查网络后刷新页面。</Notice>
          : !list.data ? <ListLoading rows={4} label="正在加载风险提醒" />
          : !rows.length ? (
            <div className="dc-card dc-empty">
              <span className="dc-empty-icon"><Icon name="warning" /></span>
              <h3>{tab === 'open' ? '没有未处理的风险提醒' : '没有符合条件的风险提醒'}</h3>
            </div>
          ) : (
            <>
              {days.map((d) => (
                <section key={d.key} aria-label={d.title}>
                  <p className="dc-list-title">{d.title}</p>
                  <ul className="dc-list">
                    {d.alerts.map((a) => <AlertRow key={a.id} a={a} href={alertsHref(filters, a.id)} timeOnly fresh={a.id === fresh?.id} />)}
                  </ul>
                </section>
              ))}
              {list.hasNextPage && (
                <button className={`dc-btn dc-btn-secondary ${list.isFetchingNextPage ? 'is-loading' : ''}`} type="button"
                  disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>更早的提醒</button>
              )}
            </>
          )}
      </section>
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </Desk>
  );
}
