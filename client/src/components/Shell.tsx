import { usePathname } from 'expo-router';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { replay } from '@/lib/motion';
import type { Me, Role } from '@/lib/session';
import { keepTab } from './Sheet';
import { Icon, link, type IconName } from './ui';

// Back-office sections and who may open them (PHASE-1.md §4.2).
export const SECTIONS: { href: string; icon: IconName; label: string; roles: Role[]; kind?: string }[] = [
  { href: '/admin/students', icon: 'me', label: '学生', roles: ['teacher', 'president', 'sysadmin'] },
  { href: '/admin/txns', icon: 'passbook', label: '流水', roles: ['accountant', 'teacher', 'president'] },
  { href: '/admin/reports', icon: 'ranking', label: '报表', roles: ['accountant', 'teacher', 'president'] },
  { href: '/admin/cash', icon: 'balance', label: '轧账', roles: ['accountant', 'teacher', 'president'] },
  { href: '/admin/products', icon: 'exchange', label: '商品', roles: ['storekeeper', 'accountant', 'teacher', 'president'], kind: 'dc-kind-exchange' },
  { href: '/admin/stock', icon: 'inbox', label: '出入库', roles: ['storekeeper', 'teacher', 'president'] },
  { href: '/admin/staff', icon: 'teacher', label: '人员', roles: ['teacher', 'president', 'sysadmin'] },
  { href: '/admin/attendance', icon: 'calendar', label: '考勤', roles: ['teacher', 'president'] },
  { href: '/admin/terms', icon: 'school', label: '学期', roles: ['teacher', 'president', 'accountant'] },
  { href: '/admin/credit', icon: 'gauge', label: '信用分', roles: ['accountant', 'teacher', 'president'] },
  { href: '/admin/loans', icon: 'loan', label: '贷款', roles: ['accountant', 'teacher', 'president'], kind: 'dc-kind-withdraw' },
  { href: '/admin/rates', icon: 'rate', label: '利率', roles: ['accountant', 'teacher', 'president'] },
  { href: '/admin/wealth', icon: 'invest', label: '理财', roles: ['accountant', 'teacher', 'president'] },
  { href: '/admin/settings', icon: 'settings', label: '参数', roles: ['teacher', 'president'] },
  { href: '/admin/audit', icon: 'bell', label: '日志', roles: ['teacher', 'president', 'sysadmin'] },
];
export const sectionsFor = (me: Me) => SECTIONS.filter((s) => s.roles.some((r) => me.roles.includes(r)));

type NavItem = { href: string; icon: IconName; label: string; exact?: boolean; kind?: string };

// The pages of this login's identity.
function navItems(me: Me): NavItem[] {
  if (me.student) {
    return [
      { href: '/student', icon: 'home', label: '首页', exact: true },
      { href: '/student/txns', icon: 'passbook', label: '明细' },
      { href: '/student/credit', icon: 'gauge', label: '信用' },
      { href: '/student/ranking', icon: 'ranking', label: '排名' },
      { href: '/student/me', icon: 'me', label: '我的' },
    ];
  }
  if (me.roles.includes('teller')) {
    return [
      { href: '/counter', icon: 'coin', label: '办理', exact: true },
      { href: '/counter/today', icon: 'passbook', label: '今日业务' },
      { href: '/counter/attendance', icon: 'calendar', label: '考勤' },
      { href: '/counter/me', icon: 'me', label: '我的' },
    ];
  }
  return [{ href: '/admin', icon: 'home', label: '总览', exact: true }, ...sectionsFor(me), { href: '/admin/me', icon: 'me', label: '我的' }];
}

// A page in the middle of a business (it has a back button) hides the phone TabBar (layout.md, AppShell).
const InFlow = createContext<(on: boolean) => void>(() => {});
// Opens 全部功能 when the login has more pages than the phone TabBar holds.
const OpenApps = createContext<(() => void) | null>(null);

// Whether the page change under way goes back: a page's back button or the browser's history; every other is forward.
// shortcut: the browser's forward button fires the same popstate and slides as a return, read the history index to tell them apart.
let returning = false;
const PAGE_MOTION = ['dc-page-forward', 'dc-page-back'];

// Slides the pages in as the path changes (motion.md), the navigation staying put. Not on the shell's first page.
function usePageMotion(path: string) {
  const main = useRef<HTMLDivElement>(null);
  const shown = useRef(path);
  useEffect(() => {
    const back = () => { returning = true; };
    addEventListener('popstate', back);
    return () => removeEventListener('popstate', back);
  }, []);
  useLayoutEffect(() => {
    if (shown.current === path || !main.current) return;
    shown.current = path;
    main.current.classList.remove(...PAGE_MOTION);
    replay(main.current, PAGE_MOTION[returning ? 1 : 0]);
    returning = false;
  }, [path]);
  return main;
}

// AppShell: bottom TabBar on phones, icon rail on tablets, full side navigation on computers (layout.md).
export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const path = usePathname();
  const main = usePageMotion(path);
  const items = navItems(me);
  // The phone TabBar holds five, the last one 我的; 全部功能 in the page header opens every page.
  const many = items.length > 5;
  const tabs = many ? [...items.slice(0, 4), items[items.length - 1]] : items;
  const [inFlow, setInFlow] = useState(false);
  const [apps, setApps] = useState(false);
  const current = (i: NavItem) => (i.exact ? path === i.href : path.startsWith(i.href)) ? ('page' as const) : undefined;
  return (
    <div className="dc-app" onClickCapture={() => { returning = false; }}>
      <div className="dc-shell">
        <aside className="dc-nav">
          <div className="dc-nav-inner">
            <div className="dc-nav-brand"><img src="/logo.png" alt="" /><span>海豚云</span></div>
            <nav aria-label="主导航">
              {items.map((i) => <a key={i.href} className="dc-nav-item" aria-current={current(i)} {...link(i.href)}><Icon name={i.icon} />{i.label}</a>)}
            </nav>
          </div>
        </aside>
        <div className="dc-main" ref={main}>
          <InFlow.Provider value={setInFlow}><OpenApps.Provider value={many ? () => setApps(true) : null}>{children}</OpenApps.Provider></InFlow.Provider>
        </div>
        {tabs.length > 1 && !inFlow && (
          <nav className="dc-tabbar" aria-label="主导航">
            {tabs.map((i) => <a key={i.href} className="dc-tab" aria-current={current(i)} {...link(i.href)}><Icon name={i.icon} />{i.label}</a>)}
          </nav>
        )}
      </div>
      {apps && <AppsSheet items={items} current={current} onClose={() => setApps(false)} />}
    </div>
  );
}

// 全部功能 (design system AppShell): every page of the login as a tile, the way ConfirmSheet opens and closes. A
// tile goes to its page and closes the sheet; the current page's only closes it. Focus starts on the current page's
// tile, stays in the sheet, and goes back to the 全部功能 button, the new page's after a tile was followed.
function AppsSheet({ items, current, onClose }: { items: NavItem[]; current: (i: NavItem) => 'page' | undefined; onClose: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tile = (q: string) => sheet.current!.querySelector<HTMLElement>(q);
    (tile('.dc-tile[aria-current="page"]') ?? tile('.dc-tile'))?.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLeaving(true);
      if (e.key === 'Tab') keepTab(e, sheet.current!);
    };
    document.addEventListener('keydown', keys);
    return () => {
      document.removeEventListener('keydown', keys);
      document.querySelector<HTMLElement>('.dc-apps-btn')?.focus();
    };
  }, []);
  return createPortal(
    <div className="dc-app" style={{ position: 'fixed', inset: 0, zIndex: 10, minHeight: 0, background: 'none' }}>
    <div className={`dc-scrim ${leaving ? 'is-leaving' : ''}`} onClick={(e) => e.target === e.currentTarget && setLeaving(true)}
      onAnimationEnd={(e) => leaving && e.target === e.currentTarget && onClose()}>
      <div ref={sheet} className="dc-sheet is-apps" role="dialog" aria-modal="true" aria-labelledby="dc-apps-title">
        <div className="dc-section-head">
          <h2 className="dc-sheet-title" id="dc-apps-title">全部功能</h2>
          <button className="dc-icon-btn" type="button" aria-label="关闭" onClick={() => setLeaving(true)}><Icon name="close" /></button>
        </div>
        <nav className="dc-tiles" aria-label="全部功能">
          {items.map((i) => {
            const here = current(i);
            const go = link(i.href);
            return (
              <a key={i.href} className={`dc-tile ${i.kind ?? ''}`} aria-current={here} href={go.href}
                onClick={(e) => { if (here) e.preventDefault(); else go.onClick(e); setLeaving(true); }}>
                <span className="dc-tile-icon"><Icon name={i.icon} /></span>{i.label}
              </a>
            );
          })}
        </nav>
      </div>
    </div>
    </div>,
    document.body,
  );
}

// One page inside the shell: the title row (back, title, quiet subtitle, actions on the right) and the content column.
export function Page({ title, sub, back, actions, children }: {
  title: string; sub?: ReactNode; back?: () => void; actions?: ReactNode; children: ReactNode;
}) {
  const setInFlow = useContext(InFlow);
  const openApps = useContext(OpenApps);
  const inFlow = !!back;
  useEffect(() => {
    setInFlow(inFlow);
    return () => setInFlow(false);
  }, [setInFlow, inFlow]);
  return (
    <>
      <header className="dc-top">
        {back && <button className="dc-icon-btn" type="button" aria-label="返回" onClick={() => { returning = true; back(); }}><Icon name="back" /></button>}
        <h1 className="dc-top-title title">{title}{sub && <span className="dc-top-sub">{sub}</span>}</h1>
        {actions}
        {!back && openApps && (
          <button className="dc-icon-btn dc-apps-btn" type="button" aria-label="全部功能" aria-haspopup="dialog" onClick={openApps}><Icon name="apps" /></button>
        )}
      </header>
      <main className="dc-content">{children}</main>
    </>
  );
}
