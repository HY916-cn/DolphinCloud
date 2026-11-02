import { Redirect, useLocalSearchParams, type Href } from 'expo-router';
import { Gate, Notice, SignOutBlock, Welcome } from '@/components';
import { home } from '@/lib/session';

// "/" sends a login to the place of its identity; with ?switch=1 (after 退出账号) to its 切换账号.
export default function Index() {
  const switching = !!useLocalSearchParams().switch;
  return (
    <Gate allow={() => true}>
      {(me) => {
        const place = home(me);
        if (place) return <Redirect href={(switching ? `${place}/me?switch=1` : place) as Href} />;
        return (
          <Welcome label="账号状态">
            <Notice title="账号还没有分配身份">请联系银行管理员为你的账号分配角色。</Notice>
            <SignOutBlock />
          </Welcome>
        );
      }}
    </Gate>
  );
}
