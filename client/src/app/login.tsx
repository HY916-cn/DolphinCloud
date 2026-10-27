import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Button, Field, Notice, Screen, WaveDivider } from '@/components';
import { useSession } from '@/lib/session';
import { loginEmail, supabase, type LoginKind } from '@/lib/supabase';
import { color, font, radius, shadow, space, text } from '@/theme';

const KINDS: { kind: LoginKind; tab: string; field: string }[] = [
  { kind: 'student', tab: '学生登录', field: '学号' },
  { kind: 'staff', tab: '工作人员登录', field: '账号' },
];

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
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (ready && session) return <Redirect href="/" />;
  const current = KINDS.find((k) => k.kind === kind)!;

  async function signIn() {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.signInWithPassword({ email: loginEmail(kind, loginId), password });
    setBusy(false);
    if (e) return setError(message(e.code));
    queryClient.clear();
    router.replace('/');
  }

  return (
    <Screen>
      <View style={{ overflow: 'hidden', borderRadius: radius.lg, backgroundColor: color.cloud100 }}>
        <View style={{ alignItems: 'center', gap: space[3], paddingTop: space[6], paddingHorizontal: space[5], paddingBottom: space[4] }}>
          <Image source={require('../../assets/logo.png')} style={{ width: 96, height: 96 }} resizeMode="contain"
            accessibilityLabel="海豚云标志" />
          <Text role="heading" aria-level={1} style={{ ...text.display, color: color.ink }}>海豚云</Text>
          <Text style={{ ...text.body, color: color.inkMuted }}>明德实验学校海豚银行</Text>
        </View>
        <WaveDivider />
      </View>

      <View role="tablist" style={{ flexDirection: 'row', gap: space[1], padding: space[2], borderRadius: radius.lg,
        backgroundColor: color.surfaceRaised, boxShadow: shadow.card }}>
        {KINDS.map((k) => (
          <Pressable key={k.kind} role="tab" aria-selected={k.kind === kind}
            onPress={() => { setKind(k.kind); setError(null); }}
            style={{ flex: 1, alignItems: 'center', paddingVertical: space[3], borderRadius: radius.md,
              backgroundColor: k.kind === kind ? color.cloud100 : 'transparent' }}>
            <Text style={{ ...font(600), fontSize: 16, lineHeight: 26, color: k.kind === kind ? color.dolphinDeep : color.inkMuted }}>
              {k.tab}
            </Text>
          </Pressable>
        ))}
      </View>

      <Field label={current.field} icon="me" value={loginId} onChangeText={setLoginId} autoCapitalize="none"
        autoComplete="username" inputMode={kind === 'student' ? 'numeric' : 'text'}
        placeholder={kind === 'student' ? '请输入学号' : '请输入账号'} />
      <Field label="密码" icon="lock" value={password} onChangeText={setPassword} secureTextEntry
        autoComplete="current-password" placeholder="请输入密码" onSubmitEditing={signIn} />
      {error && <Notice variant="danger" title={error.title}>{error.text}</Notice>}
      <Button label={busy ? '正在登录' : '登录'} onPress={signIn} disabled={busy || !loginId.trim() || !password} />
    </Screen>
  );
}
