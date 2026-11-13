import { useQueryClient } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import { cloneElement, createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { loginError } from '@/lib/errors';
import { useMe } from '@/lib/session';
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

// What was typed on the cover, for the lid that opens from it: the 账号 and how long the 密码 is. A 存折 opened without
// its cover (already signed in) prints the student's 学号 and 8 dots there, so the lid is the login cover all the same.
let typed: { id: string; dots: number } | null = null;

// The face of the closed 存折: the bank's name and 储蓄存折 in gold foil, and on the label the 账号 and 密码 that open it.
function CoverFace({ id, password, onId, onPassword, busy, error }: {
  id: string; password: string; onId?: (v: string) => void; onPassword?: (v: string) => void; busy: boolean;
  error?: { title: string; text: string; n: number } | null;
}) {
  return (
    <>
      <p className="dc-pb-foil">海豚银行</p>
      <img src="/logo.png" alt="" />
      <h1 className="dc-pb-foil is-title">储蓄存折</h1>
      {/* The key replays the nudge on each failed attempt. */}
      <div key={error?.n} className={`dc-pb-label ${error ? 'dc-nudge' : ''}`}>
        <label><span>账号</span>
          <input value={id} onChange={(e) => onId?.(e.target.value)} readOnly={!onId} inputMode="numeric" autoComplete="username"
            autoCapitalize="none" spellCheck={false} placeholder="学号" />
        </label>
        <label><span>密码</span>
          <input type="password" value={password} onChange={(e) => onPassword?.(e.target.value)} readOnly={!onPassword} autoComplete="current-password" placeholder="密码" />
        </label>
      </div>
      {error && <p className="dc-book-error" role="alert"><b>{error.title}</b>{error.text}</p>}
      <button className={`dc-btn dc-book-unlock ${busy ? 'is-loading' : ''}`} type="submit" disabled={busy || !id.trim() || !password}>
        <Icon name="lock" />{busy ? '正在打开' : '打开存折'}
      </button>
      <p className="dc-book-help">首次使用请输入初始密码 · 忘记密码请联系银行管理员</p>
      <a className="dc-book-alt" {...link('/login')}>普通版登录</a>
    </>
  );
}

// The closed 存折, its cover the lock. It stays closed while the session and the account load (`opening`), so the
// book opens straight from it; a student already signed in sees the cover without its label.
export function BookCover({ opening }: { opening?: boolean }) {
  const queryClient = useQueryClient();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ title: string; text: string; n: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const waiting = busy || !!opening;

  async function open(e: React.FormEvent) {
    e.preventDefault();
    if (waiting || !loginId.trim() || !password) return;
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: loginEmail('student', loginId), password });
    if (err) {
      setBusy(false);
      return setError({ ...loginError(err.message.includes('LOGIN_LOCKED') ? 'LOGIN_LOCKED' : err.code), n: (error?.n ?? 0) + 1 });
    }
    typed = { id: loginId, dots: password.length };
    queryClient.clear();
  }

  return (
    <div className="dc-app dc-book">
      <main className="dc-book-desk">
        <form className={`dc-pb-cover dc-book-cover ${opening && !busy ? 'is-waiting' : ''}`} aria-label="打开存折" noValidate onSubmit={open}>
          <CoverFace id={loginId} password={password} onId={setLoginId} onPassword={setPassword} busy={waiting} error={error} />
        </form>
      </main>
    </div>
  );
}

// Closing the open 存折: the bookmarks slide back and the cover swings shut, then `then` runs (signing out, or going
// to the 普通版). Outside the 存折 it runs at once.
const Closer = createContext<(then: () => void | Promise<void>) => Promise<void>>(async (then) => { await then(); });
export const useCloseBook = () => useContext(Closer);
const OPEN_MS = 1600;
const CLOSE_MS = 1000;
const TURN_MS = 800;

// A leaf in motion over the pages: `front` is the page lifting, `back` the page printed on its other side, `under` what
// it uncovers until it has landed. All copies, gone when it lands; the pages beneath are live.
function TurningLeaf({ d, spread, under, front, back }: { d: 1 | -1; spread: boolean; under?: ReactNode; front: ReactNode; back?: ReactNode }) {
  return (
    <div className={`dc-book-turning is-${spread ? 'spread' : 'single'} is-${d > 0 ? 'next' : 'prev'}`} aria-hidden="true" inert>
      {under && <div className="dc-book-under">{under}</div>}
      <div className="dc-book-leaf">
        <div className="dc-book-face">{front}</div>
        {back && <div className="dc-book-face is-back">{back}</div>}
      </div>
    </div>
  );
}

const sectionAt = (path: string) => MARKS.findIndex((m) => m.href === path);
const printedPages = () => [...document.querySelectorAll('.dc-book-pages > .dc-passbook > .dc-pb-page')].map((p) => p.outerHTML);
const printedCopy = (html?: string) => (html ? <div className="dc-book-html" dangerouslySetInnerHTML={{ __html: html }} /> : null);

// The open 存折 with its bookmarks; `children` is the part turned to, a Passbook. Each time it is shown it opens: the
// cover swings over to the left, the first page coming round with it, and the bookmarks slide out. Changing part turns
// a leaf too, its front the page left behind and its back the page arrived at, drawn from what was printed on each.
export function BookShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [state, setState] = useState<'opening' | 'open' | 'closing'>('opening');
  const no = useMe().data?.student?.student_no ?? '';
  const [opened] = useState(() => (typed?.id.trim() === no ? typed : { id: no, dots: 8 }));
  const [shown, setShown] = useState(path);
  const [change, setChange] = useState<{ n: number; d: 1 | -1; from: string[]; to?: string[] } | null>(null);
  if (path !== shown) {
    // Read while rendering: once this commits, the part being left is gone from the document.
    setShown(path);
    if (state === 'open') setChange({ n: (change?.n ?? 0) + 1, d: sectionAt(path) > sectionAt(shown) ? 1 : -1, from: printedPages() });
  }
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the arriving pages exist only now, and must be read before paint
    if (change && !change.to) setChange({ ...change, to: printedPages() });
  }, [change]);
  const landed = change?.n;
  useEffect(() => {
    if (landed === undefined) return;
    // Read the arriving pages again just before the leaf shows its back: their figures may have come in since.
    const read = setTimeout(() => setChange((c) => c && { ...c, to: printedPages() }), TURN_MS * 0.4);
    const t = setTimeout(() => setChange(null), TURN_MS);
    return () => { clearTimeout(read); clearTimeout(t); };
  }, [landed]);
  useEffect(() => {
    const t = setTimeout(() => setState((s) => (s === 'opening' ? 'open' : s)), OPEN_MS);
    return () => clearTimeout(t);
  }, []);
  const close = async (then: () => void | Promise<void>) => {
    setState('closing');
    await new Promise((done) => setTimeout(done, CLOSE_MS));
    await then();
  };
  const leaf = (() => {
    if (!change?.to?.length) return null;
    const { d, from, to } = change;
    const spread = from.length === 2;
    const [under, front, back] = spread
      ? (d > 0 ? [from[0], from[1], to[0]] : [from[1], from[0], to[1]])
      : (d > 0 ? [undefined, from[0], undefined] : [from[0], to[0], undefined]);
    return <TurningLeaf key={change.n} d={d} spread={spread} under={printedCopy(under)} front={printedCopy(front)} back={printedCopy(back)} />;
  })();
  const lidFace = state === 'opening' ? opened : null;
  return (
    <Closer.Provider value={close}>
      <div className="dc-app dc-book">
        <main className="dc-book-desk">
          <div className={`dc-book-open ${state === 'open' ? '' : `is-${state}`}`}>
            <div className="dc-book-turn">
              {children}
              {leaf}
              {state !== 'open' && (
                <div className="dc-book-lid" aria-hidden="true" inert>
                  <div className="dc-pb-cover dc-book-cover">
                    <CoverFace id={lidFace?.id ?? ''} password={'x'.repeat(lidFace?.dots ?? 0)} busy={state === 'opening'} />
                  </div>
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

type Page = ReactElement<{ foot?: ReactNode; 'data-side'?: string }>;

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
  const [queued, setQueued] = useState<1 | -1 | 0>(0);
  const first = Math.floor(Math.min(at, Math.max(0, pages.length - 1)) / per) * per;
  const last = Math.min(first + per, pages.length) - 1;
  const go = (d: 1 | -1) => {
    if (turn) { setQueued(d); return; } // one leaf at a time; the turn asked for meanwhile follows it
    setQueued(0);
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
    if (!turn && queued) goRef.current(queued);
  }, [turn, queued]);
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
  const flip = (d: 1 | -1, label: string, live: boolean) => {
    const face = <>{d < 0 && <Icon name="back" />}{label}{d > 0 && <Icon name="next" />}</>;
    const cls = `dc-book-flip is-${d > 0 ? 'next' : 'prev'}`;
    return live ? <button className={cls} type="button" onClick={() => go(d)}>{face}</button> : <span className={cls}>{face}</span>;
  };
  // Page `i` as it is printed: its number at the foot, and on the first and last page in view the way to turn on.
  const page = (i: number, live = true) => {
    const p = pages[i];
    const side = per === 2 ? (i % 2 ? 'right' : 'left') : undefined;
    if (!p) return <section key={`blank-${i}`} className="dc-pb-page is-blank" data-side={side} aria-hidden="true" />;
    const lead = i % per === 0, end = i === Math.min(i - (i % per) + per, pages.length) - 1;
    return cloneElement(p, {
      key: live ? `slot-${i % per}` : `copy-${i}`, // a slot keeps its page element, so turning does not replay its opening
      'data-side': side,
      foot: <><span>{lead && i > 0 && flip(-1, '上一页', live)}</span>
        <span>第 {i + 1} 页</span>
        <span>{end && i < pages.length - 1 && flip(1, '下一页', live)}</span></>,
    });
  };
  // The leaf in motion, from the pages that were in view (`from`) to the ones now in view.
  const leaf = (() => {
    if (!turn) return null;
    const { d, from } = turn;
    const [under, front, back] = per === 2
      ? (d > 0 ? [from, from + 1, from + 2] : [from + 1, from, from - 1])
      : (d > 0 ? [null, from, null] : [from, from - 1, null]);
    return <TurningLeaf key={turn.n} d={d} spread={per === 2} under={under !== null && page(under, false)} front={page(front, false)} back={back !== null && page(back, false)} />;
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
