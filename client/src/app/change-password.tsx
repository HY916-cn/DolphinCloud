import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Icon, Loading, Notice, SignOutBlock, Welcome } from '@/components';
import { useMe, useSession } from '@/lib/session';
import { DEFAULT_PASSWORD, supabase } from '@/lib/supabase';

function PasswordField({ label, placeholder, value, onChange }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <label className="dc-login-field">
      <Icon name="lock" />
      <span className="dc-login-label">{label}</span>
      <input type="password" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" placeholder={placeholder} />
    </label>
  );
}

// Shown while a login still has the default password; this is the one time a person sets their own password.
export default function ChangePassword() {
  const { session, ready } = useSession();
  const me = useMe();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ready || (session && me.isPending)) return <Loading />;
  if (!session || !me.data?.profile.must_change_password) return <Redirect href="/" />;
  const min = me.data.profile.login_kind === 'student' ? 6 : 8;
  const problem =
    password.length < min ? `新密码至少 ${min} 位`
    : password === DEFAULT_PASSWORD ? '新密码不能是默认密码'
    : repeat && repeat !== password ? '两次输入的密码不一致，请重新输入'
    : null;

  // A rule is shown once both boxes are filled, so it does not interrupt the first entry.
  const shown = error ?? (repeat ? problem : null);

  async function save() {
    if (busy || problem || repeat !== password) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (e) return setError(e.code === 'same_password' ? '新密码不能是默认密码' : '暂时无法设置密码，请检查网络后重试');
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    router.replace('/');
  }

  return (
    <Welcome label="设置新密码" onSubmit={save}>
      <h2 className="dc-login-title">设置新密码</h2>
      <p style={{ margin: 0 }}>你正在使用默认密码，请设置新密码。设置后不能自行修改，忘记时请联系老师重置。</p>
      <PasswordField label="新密码" placeholder={`新密码，至少 ${min} 位`} value={password} onChange={setPassword} />
      <PasswordField label="再次输入新密码" placeholder="再次输入新密码" value={repeat} onChange={setRepeat} />
      {shown && <Notice tone="danger" title={shown} />}
      <button className={`dc-btn dc-btn-primary dc-btn-block ${busy ? 'is-loading' : ''}`} type="submit"
        disabled={!busy && (!!problem || repeat !== password)}>
        {busy ? '正在设置' : '设置密码'}
      </button>
      <SignOutBlock light />
    </Welcome>
  );
}
