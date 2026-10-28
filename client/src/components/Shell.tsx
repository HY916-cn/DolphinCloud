import { usePathname } from 'expo-router';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Me } from '@/lib/session';
import { Icon, link, type IconName } from './ui';

// The pages of this login's identity.
function navItems(me: Me): { href: string; icon: IconName; label: string; exact?: boolean }[] {
  if (me.student) return [{ href: '/student', icon: 'home', label: '首页', exact: true }, { href: '/student/me', icon: 'me', label: '我的' }];
  if (me.roles.includes('teller')) {
    return [
      { href: '/counter/deposit', icon: 'deposit', label: '存款' },
      { href: '/counter/withdraw', icon: 'withdraw', label: '取款' },
      { href: '/counter/shop', icon: 'exchange', label: '兑换' },
      { href: '/counter/lookup', icon: 'query', label: '查询' },
      { href: '/counter/reversal', icon: 'transfer', label: '冲正' },
    ];
  }
  return [{ href: '/admin', icon: 'teacher', label: '后台' }];
}

// A page in the middle of a business (it has a back button) hides the phone TabBar (layout.md, AppShell).
const InFlow = createContext<(on: boolean) => void>(() => {});

// AppShell: bottom TabBar on phones, icon rail on tablets, full side navigation on computers (layout.md).
export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const path = usePathname();
  const items = navItems(me);
  const [inFlow, setInFlow] = useState(false);
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
        <div className="dc-main"><InFlow.Provider value={setInFlow}>{children}</InFlow.Provider></div>
        {items.length > 1 && !inFlow && (
          <nav className="dc-tabbar" aria-label="主导航">
            {items.map((i) => <a key={i.href} className="dc-tab" aria-current={current(i)} {...link(i.href)}><Icon name={i.icon} />{i.label}</a>)}
          </nav>
        )}
      </div>
    </div>
  );
}

// One page inside the shell: the title row (back, title, quiet subtitle, actions on the right) and the content column.
export function Page({ title, sub, back, actions, children }: {
  title: string; sub?: ReactNode; back?: () => void; actions?: ReactNode; children: ReactNode;
}) {
  const setInFlow = useContext(InFlow);
  useEffect(() => {
    setInFlow(!!back);
    return () => setInFlow(false);
  }, [setInFlow, !!back]);
  return (
    <>
      <header className="dc-top">
        {back && <button className="dc-icon-btn" type="button" aria-label="返回" onClick={back}><Icon name="back" /></button>}
        <h1 className="dc-top-title title">{title}{sub && <span className="dc-top-sub">{sub}</span>}</h1>
        {actions}
      </header>
      <main className="dc-content">{children}</main>
    </>
  );
}
