import { Redirect } from 'expo-router';
import { Notice, Screen } from '@/components';
import { Gate, SignOutButton } from '@/lib/gate';
import { destinations } from '@/lib/session';

// "/" picks where a login works: straight there when there is one place, the chooser when there are several.
export default function Index() {
  return (
    <Gate allow={() => true}>
      {(me) => {
        const places = destinations(me);
        if (places.length === 1) return <Redirect href={places[0]} />;
        if (places.length > 1) return <Redirect href="/workspace" />;
        return (
          <Screen>
            <Notice title="账号还没有分配业务">请联系指导老师为你的账号分配角色。</Notice>
            <SignOutButton />
          </Screen>
        );
      }}
    </Gate>
  );
}
