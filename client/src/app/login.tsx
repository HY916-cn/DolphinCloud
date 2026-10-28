import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Icon, Notice, Welcome } from '@/components';
import { useSession } from '@/lib/session';
import { loginEmail, supabase, type LoginKind } from '@/lib/supabase';

const KINDS = [
  { kind: 'student', label: '学生', icon: 'me', field: '学号', placeholder: '请输入学号', inputMode: 'numeric' },
  { kind: 'staff', label: '工作人员', icon: 'teacher', field: '账号', placeholder: '请输入账号', inputMode: 'text' },
] as const;

// Auth error codes → what the person can do about it.
function message(code?: string) {
  if (code === 'user_banned') return { title: '账号已停用', text: '请联系指导老师。' };
  if (code === 'over_request_rate_limit') return { title: '尝试次数过多', text: '请稍后再登录。' };
  if (code === 'invalid_credentials') return { title: '账号或密码不正确', text: '请核对后重新输入。' };
  return { title: '暂时无法登录', text: '请检查网络后重试。' };
}

export default function Login() {
  const { session, ready } = useSession();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<LoginKind>('student');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ title: string; text: string; n: number } | null>(null);
  const [busy, setBusy] = useState(false);
  if (ready && session) return <Redirect href="/" />;
  const current = KINDS.find((k) => k.kind === kind)!;

  async function signIn() {
    if (busy || !loginId.trim() || !password) return;
    setBusy(true);
    const { error: e } = await supabase.auth.signInWithPassword({ email: loginEmail(kind, loginId), password });
    setBusy(false);
    if (e) return setError({ ...message(e.code), n: (error?.n ?? 0) + 1 });
    queryClient.clear();
    router.replace('/');
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
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <button className={`dc-btn dc-btn-primary dc-btn-block ${busy ? 'is-loading' : ''}`} type="submit"
        disabled={!busy && (!loginId.trim() || !password)}>
        {busy ? '正在登录' : '登录'}
      </button>
      <p className="dc-login-help">首次登录请使用默认密码，登录后设置新密码<br />忘记密码请联系指导老师</p>
    </Welcome>
  );
}
