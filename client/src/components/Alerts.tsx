import { useQuery } from '@tanstack/react-query';
import { alertLine, alertObject, handledLine, KINDS, type Alert, type AlertStatus } from '@/lib/alerts';
import { call } from '@/lib/rpc';
import { Icon, link } from './ui';

const TAGS: Record<AlertStatus, [string, 'clock' | 'check' | 'close', string]> = {
  open: ['dc-tag dc-tag-pending', 'clock', '未处理'], seen: ['dc-tag', 'check', '已查看'], terminated: ['dc-tag', 'close', '已终止'],
};
export function AlertTag({ status }: { status: AlertStatus }) {
  const [className, icon, label] = TAGS[status];
  return <span className={className}><Icon name={icon} />{label}</span>;
}

// One alert in a list (design system RiskAlerts 一行提醒), the whole row a link to its page: the kind's icon, "名称 · 对象"
// with its status, the time and 说明, and who handled it. `timeOnly` under a day's title.
export function AlertRow({ a, href, timeOnly, fresh }: { a: Alert; href: string; timeOnly?: boolean; fresh?: boolean }) {
  const handled = handledLine(a);
  return (
    <li>
      <a className={`dc-list-link ${fresh ? 'is-new' : ''}`} {...link(href)}>
        <span className="dc-list-icon"><Icon name={KINDS[a.kind].icon} /></span>
        <span>
          {KINDS[a.kind].name} · {alertObject(a)} <AlertTag status={a.status} />
          <small>{alertLine(a, timeOnly)}</small>
          {handled && <small>{handled}</small>}
        </span>
        <Icon name="next" />
      </a>
    </li>
  );
}

// 未处理 alerts: how many, and the five newest (§16.2 总览), for the president and the bank admin.
export function useAlertOverview(enabled = true) {
  return useQuery({ queryKey: ['risk-alerts', 'overview'], enabled, queryFn: () => call<{ open: number; recent: Alert[] }>('risk_alert_overview', {}) });
}
