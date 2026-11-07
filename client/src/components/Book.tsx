import { useQueryClient } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import { cloneElement, createContext, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { loginError } from '@/lib/errors';
import { loginEmail, supabase } from '@/lib/supabase';
import { Passbook } from './Passbook';
import { Icon, link } from './ui';

// The 存折版: the student pages as one 存折, for students only. Closed, its cover is the lock: 账号 and 密码 on the
// label open it. Open, bookmarks down its right edge turn to each part of the account.

const MARKS = [
  { href: '/book', label: '账户' },
  { href: '/book/txns', label: '明细' },
  { href: '/book/ranking', label: '排名' },
  { href: '/book/me', label: '我的' },
] as const;

// The closed 存折: the bank's name and 储蓄存折 in gold foil, and on the label the 账号 and 密码 that open it.
export function BookCover() {
  const queryClient = useQueryClient();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ title: string; text: string; n: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function open(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !loginId.trim() || !password) return;
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: loginEmail('student', loginId), password });
    setBusy(false);
    if (err) return setError({ ...loginError(err.message.includes('LOGIN_LOCKED') ? 'LOGIN_LOCKED' : err.code), n: (error?.n ?? 0) + 1 });
    queryClient.clear();
  }

  return (
    <div className="dc-app dc-book">
      <main className="dc-book-desk">
        <form className="dc-pb-cover dc-book-cover" aria-label="打开存折" noValidate onSubmit={open}>
          <p className="dc-pb-foil">海豚银行</p>
          <img src="/logo.png" alt="" />
          <h1 className="dc-pb-foil is-title">储蓄存折</h1>
          {/* The key replays the nudge on each failed attempt. */}
          <div key={error?.n} className={`dc-pb-label ${error ? 'dc-nudge' : ''}`}>
            <label><span>账号</span>
              <input value={loginId} onChange={(e) => setLoginId(e.target.value)} inputMode="numeric" autoComplete="username"
                autoCapitalize="none" spellCheck={false} placeholder="学号" />
            </label>
            <label><span>密码</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="密码" />
            </label>
          </div>
          {error && <p className="dc-book-error" role="alert"><b>{error.title}</b>{error.text}</p>}
          <button className={`dc-btn dc-book-unlock ${busy ? 'is-loading' : ''}`} type="submit" disabled={busy || !loginId.trim() || !password}>
            <Icon name="lock" />{busy ? '正在打开' : '打开存折'}
          </button>
          <p className="dc-book-help">首次使用请输入初始密码 · 忘记密码请联系银行管理员</p>
        </form>
        <a className="dc-book-alt" {...link('/login')}>普通版登录</a>
      </main>
    </div>
  );
}

// Closing the open 存折: the bookmarks slide back and the cover swings shut, then `then` runs (signing out, or going
// to the 普通版). Outside the 存折 it runs at once.
const Closer = createContext<(then: () => void | Promise<void>) => Promise<void>>(async (then) => { await then(); });
export const useCloseBook = () => useContext(Closer);
const OPEN_MS = 1800;
const CLOSE_MS = 1000;

// The open 存折 with its bookmarks; `children` is the part turned to, a Passbook. Each time it is shown it opens: the
// cover swings over to the left with the account page on its back, and the bookmarks slide out.
export function BookShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [state, setState] = useState<'opening' | 'open' | 'closing'>('opening');
  // On a phone the top sheet turns away on each change of part, not on the opening.
  const [first] = useState(path);
  const [turned, setTurned] = useState(false);
  if (path !== first && !turned) setTurned(true);
  useEffect(() => {
    // Each part's page is loaded while the cover opens, so turning to it never shows an empty book.
    Promise.all([import('@/app/book/txns'), import('@/app/book/ranking'), import('@/app/book/me')]).catch(() => {});
    const t = setTimeout(() => setState((s) => (s === 'opening' ? 'open' : s)), OPEN_MS);
    return () => clearTimeout(t);
  }, []);
  const close = async (then: () => void | Promise<void>) => {
    setState('closing');
    await new Promise((done) => setTimeout(done, CLOSE_MS));
    await then();
  };
  return (
    <Closer.Provider value={close}>
      <div className="dc-app dc-book">
        <main className="dc-book-desk">
          <div className={`dc-book-open ${state === 'open' ? '' : `is-${state}`}`}>
            <div key={path} className="dc-book-turn">
              {children}
              {turned && <div className="dc-book-sheet" aria-hidden="true" />}
              {state !== 'open' && (
                <div className="dc-book-lid" aria-hidden="true">
                  <div><p className="dc-pb-foil">海豚银行</p><img src="/logo.png" alt="" /><p className="dc-pb-foil is-title">储蓄存折</p></div>
                </div>
              )}
            </div>
            <nav className="dc-book-marks" aria-label="存折栏目">
              {MARKS.map((m, i) => (
                <a key={m.href} className="dc-book-mark" style={{ '--i': i } as React.CSSProperties} {...link(m.href)}
                  aria-current={path === m.href ? 'page' : undefined}>{m.label}</a>
              ))}
            </nav>
          </div>
        </main>
      </div>
    </Closer.Provider>
  );
}

// Two pages face each other on a computer (the app's 1024px breakpoint); a phone or tablet shows one page at a time.
export function useWide() {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

// Printed lines on one page of the 存折: as many as a page holds without scrolling, on a computer and on a phone.
export const useLines = () => (useWide() ? 10 : 8);

type Page = ReactElement<{ foot?: ReactNode }>;
const TURN_MS = 800;

// A part's pages, PassbookPages in order, in the 存折's fixed size: turned with 上一页 and 下一页 at the foot of the
// pages, by swiping across them, or with the arrow keys. Each page is numbered at its foot. `onShow` hears the last
// page in view, so a part can load what that page prints.
// A turn is a real leaf: on a computer the right page lifts at the binding and lands on the left with the next page
// printed on its back (going back, the left page turns over to the right); on a phone the page turns away over the
// left edge, or the page before comes back over it. Copies of the pages draw the leaf; the pages under it are live.
export function BookPages({ pages, onShow }: { pages: Page[]; onShow?: (last: number) => void }) {
  const per = useWide() ? 2 : 1;
  const [at, setAt] = useState(0);
  const [turn, setTurn] = useState<{ d: 1 | -1; from: number; n: number } | null>(null);
  const first = Math.floor(Math.min(at, Math.max(0, pages.length - 1)) / per) * per;
  const last = Math.min(first + per, pages.length) - 1;
  const go = (d: 1 | -1) => {
    const to = first + d * per;
    if (to < 0 || to >= pages.length) return;
    setTurn((t) => ({ d, from: first, n: (t?.n ?? 0) + 1 }));
    setAt(to);
  };
  const goRef = useRef(go);
  useEffect(() => { goRef.current = go; });
  useEffect(() => { onShow?.(last); }, [last]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!turn) return;
    const t = setTimeout(() => setTurn(null), TURN_MS);
    return () => clearTimeout(t);
  }, [turn]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') goRef.current(1);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') goRef.current(-1);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const flip = (d: 1 | -1, label: string) => (
    <button className={`dc-book-flip is-${d > 0 ? 'next' : 'prev'}`} type="button" onClick={() => go(d)}>
      {d < 0 && <Icon name="back" />}{label}{d > 0 && <Icon name="next" />}
    </button>
  );
  // Page `i` as it is printed: its number at the foot, and on the first and last page in view the way to turn on.
  const page = (i: number, live = true) => {
    const p = pages[i];
    if (!p) return <section key={`blank-${i}`} className="dc-pb-page is-blank" aria-hidden="true" />;
    const lead = i % per === 0, end = i === Math.min(i - (i % per) + per, pages.length) - 1;
    return cloneElement(p, {
      key: live ? `slot-${i % per}` : `copy-${i}`, // a slot keeps its page element, so turning does not replay its opening
      foot: <><span>{lead && i > 0 && (live ? flip(-1, '上一页') : <span className="dc-book-flip">上一页</span>)}</span>
        <span>第 {i + 1} 页</span>
        <span>{end && i < pages.length - 1 && (live ? flip(1, '下一页') : <span className="dc-book-flip">下一页</span>)}</span></>,
    });
  };
  // The leaf in motion, from the pages that were in view (`from`) to the ones now in view.
  const leaf = (() => {
    if (!turn) return null;
    const { d, from } = turn;
    const [under, front, back] = per === 2
      ? (d > 0 ? [from, from + 1, from + 2] : [from + 1, from, from - 1])
      : (d > 0 ? [null, from, null] : [from, from - 1, null]);
    return (
      <div key={turn.n} className={`dc-book-turning is-${per === 2 ? 'spread' : 'single'} is-${d > 0 ? 'next' : 'prev'}`} aria-hidden="true" inert>
        {under !== null && <div className="dc-book-under">{page(under, false)}</div>}
        <div className="dc-book-leaf">
          <div className="dc-book-face">{page(front, false)}</div>
          {back !== null && <div className="dc-book-face is-back">{page(back, false)}</div>}
        </div>
      </div>
    );
  })();

  return (
    <div className="dc-book-pages"
      onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s) return;
        const dx = e.clientX - s.x, dy = e.clientY - s.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      }}>
      <Passbook spread>
        {Array.from({ length: per }, (_, k) => page(first + k))}
      </Passbook>
      {leaf}
    </div>
  );
}

// 页面样式 (both versions' 我的): the 普通版 and the 存折版 as two choices, each with a small picture of itself. Leaving
// the 存折 closes it first; opening it plays its opening.
export function ViewSwitch({ current }: { current: 'normal' | 'book' }) {
  const close = useCloseBook();
  const go = (to: 'normal' | 'book') => {
    if (to === current) return;
    if (to === 'book') router.navigate('/book');
    else close(() => router.replace('/student'));
  };
  return (
    <fieldset className="dc-view-switch">
      <legend>页面样式</legend>
      {([['normal', '普通版', '卡片式的页面'], ['book', '存折版', '一本可以翻的存折']] as const).map(([v, label, note]) => (
        <label key={v} className="dc-view-opt">
          <input type="radio" name="student-view" checked={current === v} onChange={() => go(v)} />
          <span className={`dc-view-art is-${v}`} aria-hidden="true"><i /><i /><i /></span>
          <span className="dc-view-text"><b>{label}</b><small>{note}</small></span>
        </label>
      ))}
    </fieldset>
  );
}
