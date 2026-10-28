import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { icons, type IconName } from '@/theme/icons';

export type { IconName };

// The design system's Lucide icons, inline so the colour follows the text (README "图标").
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="dc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[name] }} />
  );
}

// Props for an <a> that navigates inside the app without reloading the page.
export function link(href: string) {
  return {
    href,
    onClick: (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      router.navigate(href as Href);
    },
  };
}

const NOTICE = { info: 'help', success: 'success', danger: 'warning', coin: 'coin' } as const;

export function Notice({ tone = 'info', title, children, className = '' }: {
  tone?: keyof typeof NOTICE; title: string; children?: ReactNode; className?: string;
}) {
  return (
    <div className={`dc-notice ${tone === 'info' ? '' : `dc-notice-${tone}`} ${className}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={NOTICE[tone]} />
      <div>
        <p className="dc-notice-title">{title}</p>
        {children && <p className="dc-notice-text">{children}</p>}
      </div>
    </div>
  );
}

// While the session or profile loads: the empty page ground, so nothing jumps.
export function Loading() {
  return <div className="dc-app" aria-busy="true" aria-label="正在加载" />;
}
