import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { DeviceAccounts, Icon, link, Notice, Welcome } from '@/components';
import { dropClosed, savedAccounts, setSaved } from '@/lib/accounts';
import { loginError } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { loginEmail, supabase, type LoginKind } from '@/lib/supabase';

const KINDS = [
  { kind: 'student', label: '学生', icon: 'me', field: '学号', placeholder: '请输入学号', inputMode: 'numeric' },
  { kind: 'staff', label: '工作人员', icon: 'teacher', field: '账号', placeholder: '请输入账号', inputMode: 'text' },
] as const;

export default function Login() {
  const { session, ready } = useSession();
  // ?switch=1 (我的 → 切换账号): this device's accounts while signed in. ?add=1 (添加账号): the form alone, to sign in
  // another account; the current one stays remembered (lib/accounts.ts).
  const params = useLocalSearchParams<{ switch?: string; add?: string }>();
  const adding = params.add === '1';
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<LoginKind>('student');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ title: string; text: string; n: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [save, setSave] = useState(false);
  // Accounts closed since they signed in here leave the list once the server says so; until then it shows them.
  useQuery({ queryKey: ['device-accounts'], staleTime: 0, queryFn: async () => { await dropClosed(); return savedAccounts().map((a) => a.id); } });
  if (ready && session && !adding && params.switch !== '1') return <Redirect href="/" />;
  const current = KINDS.find((k) => k.kind === kind)!;
  const accounts = savedAccounts();
  // 在此设备保存登录 is asked the first time an account signs in on this device.
  const known = accounts.some((a) => a.kind === kind && a.loginId === loginId.trim().toLowerCase() && a.saved);

  async function signIn() {
    if (busy || !loginId.trim() || !password) return;
    setBusy(true);
    const { data, error: e } = await supabase.auth.signInWithPassword({ email: loginEmail(kind, loginId), password });
    setBusy(false);
    if (e) {
      // The lockout (5 wrong passwords in 15 minutes) comes from the database's password check hook: code
      // invalid_credentials with the message LOGIN_LOCKED.
      const locked = e.message.includes('LOGIN_LOCKED');
      return setError({ ...loginError(locked ? 'LOGIN_LOCKED' : e.code), n: (error?.n ?? 0) + 1 });
    }
    if (!known) await setSaved(data.user.id, save);
    queryClient.clear();
    router.replace('/');
  }

  // 切换账号: this device's accounts, the last row 添加账号; also after 退出账号.
  if (!adding && accounts.length > 0) {
    return (
      <Welcome label="切换账号">
        <h2 className="dc-login-title">切换账号</h2>
        <DeviceAccounts current={session?.user.id} />
        {session && <a className="dc-btn dc-btn-ghost dc-btn-sm dc-btn-block" {...link('/')}>返回</a>}
      </Welcome>
    );
  }

  return (
    <Welcome label="登录" onSubmit={signIn}>
      <h2 className="dc-login-title">欢迎登录</h2>
      <fieldset className="dc-seg" aria-label="身份">
        {KINDS.map((k) => (
          <label key={k.kind}>
            <input type="radio" name="kind" checked={kind === k.kind} onChange={() => { setKind(k.kind); setError(null); }} />
            <span><Icon name={k.icon} />{k.label}</span>
          </label>
        ))}
      </fieldset>
      <label className="dc-login-field">
        <Icon name="me" />
        <span className="dc-login-label">{current.field}</span>
        <input value={loginId} onChange={(e) => setLoginId(e.target.value)} inputMode={current.inputMode}
          autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder={current.placeholder} />
      </label>
      {/* The key replays the nudge on each failed attempt. */}
      <label key={error?.n} className={`dc-login-field ${error ? 'dc-nudge' : ''}`}>
        <Icon name="lock" />
        <span className="dc-login-label">密码</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password" placeholder="请输入密码" />
      </label>
      {!known && (
        <label className="dc-check dc-login-save" title="保存后，在这台设备上切换回这个账号不用再输入密码">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          <span className="dc-check-box" />
          <span>在此设备保存登录<small>公用设备请不要勾选</small></span>
        </label>
      )}
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <button className={`dc-btn dc-btn-primary dc-btn-block ${busy ? 'is-loading' : ''}`} type="submit"
        disabled={busy || !loginId.trim() || !password}>
        {busy ? '正在登录' : '登录'}
      </button>
      {accounts.length > 0 ? (
        <a className="dc-btn dc-btn-ghost dc-btn-sm dc-btn-block" {...link(session ? '/login?switch=1' : '/login')}>返回切换账号</a>
      ) : (
        <p className="dc-login-help">首次登录请使用初始密码，登录后设置新密码<br />忘记密码请联系银行管理员</p>
      )}
      {kind === 'student' && <a className="dc-btn dc-btn-ghost dc-btn-sm dc-btn-block" {...link('/book')}>打开存折版</a>}
    </Welcome>
  );
}
