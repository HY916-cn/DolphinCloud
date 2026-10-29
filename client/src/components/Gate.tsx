import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { useMe, useSession, type Me } from '@/lib/session';
import { SignOut } from './Sheet';
import { ShellLoading } from './Skeleton';
import { Notice } from './ui';
import { Welcome } from './Welcome';

// Renders children for a signed-in login that may be here; otherwise sends it to sign in, to set a new
// password, or back to "/" which picks the right place.
export function Gate({ allow, children }: { allow: (me: Me) => boolean; children: (me: Me) => ReactNode }) {
  const { session, ready } = useSession();
  const me = useMe();
  if (!ready || (session && me.isPending)) return <ShellLoading />;
  if (!session) return <Redirect href="/login" />;
  if (!me.data) {
    return (
      <Welcome label="账号信息">
        <Notice tone="danger" title="暂时无法读取账号信息">请检查网络后刷新页面。</Notice>
        <SignOutBlock />
      </Welcome>
    );
  }
  if (me.data.profile.must_change_password) return <Redirect href="/change-password" />;
  if (!allow(me.data)) return <Redirect href="/" />;
  return <>{children(me.data)}</>;
}

// "退出登录" for the panels outside the app shell: a full-width secondary button, or a light one under a form.
export function SignOutBlock({ light }: { light?: boolean }) {
  return (
    <SignOut trigger={(open) => (
      <button className={`dc-btn dc-btn-block ${light ? 'dc-btn-ghost dc-btn-sm' : 'dc-btn-secondary'}`} type="button" onClick={open}>退出登录</button>
    )} />
  );
}
