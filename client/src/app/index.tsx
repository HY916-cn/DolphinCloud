import { Redirect } from 'expo-router';
import { Gate, Notice, SignOutBlock, Welcome } from '@/components';
import { home } from '@/lib/session';

// "/" sends a login to the place of its identity.
export default function Index() {
  return (
    <Gate allow={() => true}>
      {(me) => {
        const place = home(me);
        if (place) return <Redirect href={place} />;
        return (
          <Welcome label="账号状态">
            <Notice title="账号还没有分配身份">请联系指导老师为你的账号分配角色。</Notice>
            <SignOutBlock />
          </Welcome>
        );
      }}
    </Gate>
  );
}
