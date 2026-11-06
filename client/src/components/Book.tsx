import { useQueryClient } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loginError } from '@/lib/errors';
import { loginEmail, supabase } from '@/lib/supabase';
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
