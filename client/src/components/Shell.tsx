import { usePathname } from 'expo-router';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Me, Role } from '@/lib/session';
import { Icon, link, type IconName } from './ui';

// Back-office sections and who may open them (PHASE-1.md §4.2).
export const SECTIONS: { href: string; icon: IconName; label: string; roles: Role[]; kind?: string }[] = [
  { href: '/admin/students', icon: 'me', label: '学生', roles: ['teacher', 'sysadmin'] },
  { href: '/admin/txns', icon: 'passbook', label: '流水', roles: ['accountant', 'teacher'] },
  { href: '/admin/products', icon: 'exchange', label: '商品', roles: ['storekeeper', 'teacher'], kind: 'dc-kind-exchange' },
  { href: '/admin/stock', icon: 'inbox', label: '出入库', roles: ['storekeeper', 'teacher'], kind: 'dc-kind-exchange' },
  { href: '/admin/staff', icon: 'teacher', label: '人员', roles: ['teacher', 'sysadmin'] },
  { href: '/admin/issues', icon: 'coin', label: '发行', roles: ['teacher'], kind: 'dc-kind-reward' },
  { href: '/admin/settings', icon: 'settings', label: '参数', roles: ['teacher'] },
  { href: '/admin/audit', icon: 'bell', label: '日志', roles: ['teacher', 'sysadmin'] },
];
export const sectionsFor = (me: Me) => SECTIONS.filter((s) => s.roles.some((r) => me.roles.includes(r)));

// The pages of this login's identity.
function navItems(me: Me): { href: string; icon: IconName; label: string; exact?: boolean }[] {
  if (me.student) {
    return [
      { href: '/student', icon: 'home', label: '首页', exact: true },
      { href: '/student/txns', icon: 'passbook', label: '明细' },
      { href: '/student/ranking', icon: 'ranking', label: '排名' },
      { href: '/student/me', icon: 'me', label: '我的' },
    ];
  }
  if (me.roles.includes('teller')) {
    return [
      { href: '/counter', icon: 'coin', label: '办理', exact: true },
      { href: '/counter/today', icon: 'passbook', label: '今日业务' },
    ];
  }
  return [{ href: '/admin', icon: 'home', label: '总览', exact: true }, ...sectionsFor(me)];
}

// A page in the middle of a business (it has a back button) hides the phone TabBar (layout.md, AppShell).
const InFlow = createContext<(on: boolean) => void>(() => {});

// AppShell: bottom TabBar on phones, icon rail on tablets, full side navigation on computers (layout.md).
export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const path = usePathname();
  const items = navItems(me);
  const tabs = items.slice(0, 5); // the phone TabBar holds five; every section is also a tile on 总览
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
        {tabs.length > 1 && !inFlow && (
          <nav className="dc-tabbar" aria-label="主导航">
            {tabs.map((i) => <a key={i.href} className="dc-tab" aria-current={current(i)} {...link(i.href)}><Icon name={i.icon} />{i.label}</a>)}
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
