import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import type { ReactNode } from 'react';
import { Button, Loading, Notice, Screen } from '@/components';
import { useMe, useSession, type Me } from './session';
import { supabase } from './supabase';

// Renders children for a signed-in login that may be here; otherwise sends it to sign in, to set a new
// password, or back to "/" which picks the right place.
export function Gate({ allow, children }: { allow: (me: Me) => boolean; children: (me: Me) => ReactNode }) {
  const { session, ready } = useSession();
  const me = useMe();
  if (!ready || (session && me.isPending)) return <Loading />;
  if (!session) return <Redirect href="/login" />;
  if (me.error || !me.data) {
    return (
      <Screen>
        <Notice variant="danger" title="暂时无法读取账号信息">请检查网络后刷新页面。</Notice>
        <SignOutButton />
      </Screen>
    );
  }
  if (me.data.profile.must_change_password) return <Redirect href="/change-password" />;
  if (!allow(me.data)) return <Redirect href="/" />;
  return <>{children(me.data)}</>;
}

export function SignOutButton() {
  const queryClient = useQueryClient();
  return (
    <Button variant="secondary" label="退出登录" onPress={async () => {
      await supabase.auth.signOut();
      queryClient.clear();
      router.replace('/login');
    }} />
  );
}
