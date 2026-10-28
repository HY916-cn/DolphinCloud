import { usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import type { Me } from '@/lib/session';
import { Icon, link, type IconName } from './ui';

// Every place this login may work in, in one navigation: the student's own pages first, then the desks.
function navItems(me: Me) {
  const items: { href: string; icon: IconName; label: string; exact?: boolean }[] = [];
  if (me.student) items.push({ href: '/student', icon: 'home', label: '首页', exact: true }, { href: '/student/me', icon: 'me', label: '我的' });
  if (me.roles.includes('teller')) items.push({ href: '/counter', icon: 'coin', label: '柜台' });
  if (me.roles.some((r) => r !== 'teller')) items.push({ href: '/admin', icon: 'teacher', label: '后台' });
  return items;
}

// AppShell: bottom TabBar on phones, icon rail on tablets, full side navigation on computers (layout.md).
export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const path = usePathname();
  const items = navItems(me);
  const current = (i: (typeof items)[number]) => (i.exact ? path === i.href : path.startsWith(i.href)) ? ('page' as const) : undefined;
  return (
    <div className="dc-app">
      <div className="dc-shell">
        <aside className="dc-nav">
          <div className="dc-nav-inner">
            <div className="dc-nav-brand"><img src="/logo.png" alt="" /><span>海豚云</span></div>
            <nav aria-label="主导航">
              {items.map((i) => <a key={i.href} className="dc-nav-item" aria-current={current(i)} {...link(i.href)}><Icon name={i.icon} />{i.label}</a>)}
            </nav>
          </div>
        </aside>
        <div className="dc-main">{children}</div>
        {items.length > 1 && (
          <nav className="dc-tabbar" aria-label="主导航">
            {items.map((i) => <a key={i.href} className="dc-tab" aria-current={current(i)} {...link(i.href)}><Icon name={i.icon} />{i.label}</a>)}
          </nav>
        )}
      </div>
    </div>
  );
}

// One page inside the shell: the title row (title, quiet subtitle, actions on the right) and the content column.
export function Page({ title, sub, actions, children }: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="dc-top">
        <h1 className="dc-top-title title">{title}{sub && <span className="dc-top-sub">{sub}</span>}</h1>
        {actions}
      </header>
      <main className="dc-content">{children}</main>
    </>
  );
}
