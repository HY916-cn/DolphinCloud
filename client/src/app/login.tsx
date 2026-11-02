import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Icon, link, Notice, Welcome } from '@/components';
import { savedAccounts, setSaved } from '@/lib/accounts';
import { useSession } from '@/lib/session';
import { loginEmail, supabase, type LoginKind } from '@/lib/supabase';

const KINDS = [
  { kind: 'student', label: '学生', icon: 'me', field: '学号', placeholder: '请输入学号', inputMode: 'numeric' },
  { kind: 'staff', label: '工作人员', icon: 'teacher', field: '账号', placeholder: '请输入账号', inputMode: 'text' },
] as const;

// Auth error codes → what the person can do about it.
function message(code?: string) {
  if (code === 'user_banned') return { title: '这个账号已被停用', text: '停用的账号不能登录。需要恢复时，请联系银行管理员启用。' };
  if (code === 'over_request_rate_limit') return { title: '尝试次数过多', text: '请稍后再登录。' };
  if (code === 'invalid_credentials') return { title: '账号或密码不正确', text: '请核对后重新输入。' };
  if (code === 'LOGIN_LOCKED') return { title: '密码错误次数过多', text: '请 15 分钟后再试，或请银行管理员重置密码。' };
  return { title: '暂时无法登录', text: '请检查网络后重试。' };
}

export default function Login() {
  const { session, ready } = useSession();
  // ?add=1: sign in one more account on this device; the current one stays remembered (lib/accounts.ts).
  const adding = useLocalSearchParams<{ add?: string }>().add === '1';
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<LoginKind>('student');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ title: string; text: string; n: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [save, setSave] = useState(false);
  if (ready && session && !adding) return <Redirect href="/" />;
  const current = KINDS.find((k) => k.kind === kind)!;
  // The accounts still on this device (after 退出账号, those that need their password): tap one to sign in as it.
  const others = adding ? [] : savedAccounts();
  // 在此设备保存登录 is asked the first time an account signs in on this device.
  const known = savedAccounts().some((a) => a.kind === kind && a.loginId === loginId.trim().toLowerCase() && a.saved);

  async function signIn() {
    if (busy || !loginId.trim() || !password) return;
    setBusy(true);
    const { data, error: e } = await supabase.auth.signInWithPassword({ email: loginEmail(kind, loginId), password });
    setBusy(false);
    if (e) {
      // The lockout (5 wrong passwords in 15 minutes) comes from the database's password check hook: code
      // invalid_credentials with the message LOGIN_LOCKED.
      const locked = e.message.includes('LOGIN_LOCKED');
      return setError({ ...message(locked ? 'LOGIN_LOCKED' : e.code), n: (error?.n ?? 0) + 1 });
    }
    if (!known) setSaved(data.user.id, save);
    queryClient.clear();
    router.replace('/');
  }

  return (
    <Welcome label="登录" onSubmit={signIn}>
      <h2 className="dc-login-title">{adding ? '添加账号' : others.length ? '切换账号' : '欢迎登录'}</h2>
      {others.length > 0 && (
        <div className="dc-chips" role="group" aria-label="本机账号">
          {others.map((a) => (
            <button key={a.id} className="dc-chip" type="button" aria-pressed={kind === a.kind && loginId === a.loginId}
              onClick={() => { setKind(a.kind); setLoginId(a.loginId); setPassword(''); setError(null); }}>
              <Icon name={a.kind === 'student' ? 'me' : 'teacher'} />{a.name}
            </button>
          ))}
        </div>
      )}
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
        <label className="dc-check lg-save" title="保存后，在这台设备上切换回这个账号不用再输入密码">
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
      {adding && session ? (
        <a className="dc-btn dc-btn-ghost dc-btn-sm dc-btn-block" {...link('/')}>返回</a>
      ) : (
        <p className="dc-login-help">首次登录请使用初始密码，登录后设置新密码<br />忘记密码请联系银行管理员</p>
      )}
    </Welcome>
  );
}
