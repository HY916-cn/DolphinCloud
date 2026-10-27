import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button, Field, Loading, Notice, Screen } from '@/components';
import { SignOutButton } from '@/lib/gate';
import { useMe, useSession } from '@/lib/session';
import { DEFAULT_PASSWORD, supabase } from '@/lib/supabase';
import { color, text } from '@/theme';

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

  async function save() {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (e) return setError(e.code === 'same_password' ? '新密码不能是默认密码' : '暂时无法设置密码，请检查网络后重试');
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    router.replace('/');
  }

  return (
    <Screen>
      <Text role="heading" aria-level={1} style={{ ...text.title, color: color.ink }}>设置新密码</Text>
      <Notice title="你正在使用默认密码">
        设置新密码后才能继续使用海豚云。新密码设置后无法自行修改，忘记时请联系老师重置。
      </Notice>
      <Field label="新密码" icon="lock" value={password} onChangeText={setPassword} secureTextEntry
        autoComplete="new-password" hint={`至少 ${min} 位`} error={password && problem !== null && !repeat ? problem : undefined} />
      <Field label="再次输入新密码" icon="lock" value={repeat} onChangeText={setRepeat} secureTextEntry
        autoComplete="new-password" onSubmitEditing={() => !problem && save()}
        error={repeat && problem ? problem : error ?? undefined} />
      <Button label={busy ? '正在设置' : '设置密码'} onPress={save} disabled={busy || !!problem || repeat !== password} />
      <SignOutButton />
    </Screen>
  );
}
