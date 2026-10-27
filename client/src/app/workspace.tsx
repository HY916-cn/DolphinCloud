import { router } from 'expo-router';
import { Text } from 'react-native';
import { Screen, ServiceTile, ServiceTiles } from '@/components';
import { Gate, SignOutButton } from '@/lib/gate';
import { destinations } from '@/lib/session';
import { color, text } from '@/theme';

const PLACES = {
  '/counter': { icon: 'coin', label: '柜台', note: '存款、取款、兑换' },
  '/admin': { icon: 'teacher', label: '后台', note: '账户与管理' },
  '/student': { icon: 'me', label: '我的账户', note: '余额与明细' },
} as const;

// For logins with more than one place to work, e.g. a student who is also a teller.
export default function Workspace() {
  return (
    <Gate allow={(me) => destinations(me).length > 1}>
      {(me) => (
        <Screen width={720}>
          <Text role="heading" aria-level={1} style={{ ...text.title, color: color.ink }}>你好，{me.profile.display_name}</Text>
          <Text style={{ ...text.bodyLg, color: color.ink }}>请选择要进入的页面。</Text>
          <ServiceTiles>
            {destinations(me).map((href) => (
              <ServiceTile key={href} {...PLACES[href]} onPress={() => router.push(href)} />
            ))}
          </ServiceTiles>
          <SignOutButton />
        </Screen>
      )}
    </Gate>
  );
}
