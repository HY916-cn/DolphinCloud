import { useEffect, useRef } from 'react';
import { Icon, link } from './ui';

// 全屏 on the big screens (RateBoard, BigClock): hidden by the stylesheet while full screen (Esc leaves), and not
// drawn where the browser has no full screen.
export function Fullscreen() {
  if (!document.fullscreenEnabled) return null;
  return (
    <button className="dc-btn dc-btn-secondary dc-btn-sm dc-fullscreen" type="button" onClick={() => document.documentElement.requestFullscreen()}>
      <Icon name="fullscreen" />全屏
    </button>
  );
}

const MORE = [
  { href: '/board', icon: 'rate', name: '利率看板', note: '大屏查看本周利率' },
  { href: '/clock', icon: 'clock', name: '大屏时间', note: '精确到秒的大字时钟' },
  { href: '/transfer', icon: 'upload', name: '文件传输', note: '凭 4 位取件码收发文件' },
] as const;

// 更多 in the login page's top right corner (LoginPage): the pages that need no sign-in. Esc or a click outside
// closes it and returns focus to the summary.
export function LoginMore() {
  const ref = useRef<HTMLDetailsElement>(null);
  // Listening from mount reads the element itself, so a menu opened before hydration closes too.
  useEffect(() => {
    const menu = ref.current!;
    const close = () => { if (menu.open) { menu.open = false; menu.querySelector('summary')!.focus(); } };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const down = (e: PointerEvent) => { if (!menu.contains(e.target as Node)) close(); };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', down);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', down); };
  }, []);
  return (
    <details className="dc-login-more" ref={ref}>
      <summary><Icon name="apps" />更多</summary>
      <ul aria-label="不用登录的功能">
        {MORE.map((m) => (
          <li key={m.href}><a {...link(m.href)}><span><Icon name={m.icon} /></span><span><b>{m.name}</b><small>{m.note}</small></span></a></li>
        ))}
      </ul>
    </details>
  );
}
