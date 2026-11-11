import { router, type Href } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { svgToIcon } from 'morphicons/adapters';
import { MorphIcon as Morph } from 'morphicons/react';
import { icons, type IconName } from '@/theme/icons';

export type { IconName };

// The design system's Lucide icons, inline so the colour follows the text (README "图标").
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="dc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[name] }} />
  );
}

// An Icon whose strokes morph into the next one when `name` changes (motion.md "图标变形"): only for an element
// that swaps icons as its state changes. It first draws without a morph and swaps instantly under reduced motion.
export function MorphIcon({ name }: { name: IconName }) {
  // Wrapped in fill="none": svgToIcon reads bare markup as a filled icon, and morphing that throws and blanks the page.
  // Memoised because a new object would restart the morph every render.
  const icon = useMemo(() => svgToIcon(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">${icons[name]}</svg>`), [name]);
  return <Morph className="dc-icon" icon={icon} spring={{ stiffness: 1150, damping: 67.8 }} reducedMotion="user" />;
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
