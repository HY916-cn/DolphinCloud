import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { color, font, radius, shadow, space } from '@/theme';
import { Icon, type IconName } from './Icon';

export type Tab = { href: string; icon: IconName; label: string };

// dc-tabbar: phone navigation floating at the foot of the screen; the current tab sits on cloud-100.
export function TabBar({ tabs, current }: { tabs: Tab[]; current: string }) {
  return (
    <View role="navigation" aria-label="主导航" style={{ flexDirection: 'row', gap: space[1], padding: space[2],
      backgroundColor: color.surfaceRaised, borderRadius: radius.lg, boxShadow: shadow.float }}>
      {tabs.map((t) => {
        const active = t.href === current;
        const fg = active ? color.dolphinDeep : color.inkMuted;
        return (
          <Pressable key={t.href} role="link" aria-current={active ? 'page' : undefined}
            onPress={() => !active && router.navigate(t.href as never)} style={{
              flex: 1, alignItems: 'center', gap: 2, paddingVertical: space[2], paddingHorizontal: space[1],
              borderRadius: radius.md, backgroundColor: active ? color.cloud100 : 'transparent' }}>
            <Icon name={t.icon} size={30} color={fg} />
            <Text style={{ ...font(600), fontSize: 14, lineHeight: 20, color: fg }}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
