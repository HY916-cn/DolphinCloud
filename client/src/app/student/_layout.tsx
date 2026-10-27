import { Slot, usePathname } from 'expo-router';
import { View } from 'react-native';
import { TabBar } from '@/components';
import { Gate } from '@/lib/gate';
import { color, space } from '@/theme';

const TABS = [
  { href: '/student', icon: 'home', label: '首页' },
  { href: '/student/me', icon: 'me', label: '我的' },
] as const;

// 学生端: one phone column with the tab bar floating at the foot.
export default function StudentLayout() {
  const path = usePathname();
  return (
    <Gate allow={(me) => !!me.student}>
      {() => (
        <View style={{ flex: 1, backgroundColor: color.surface }}>
          <Slot />
          <View style={{ position: 'absolute', left: space[4], right: space[4], bottom: space[4], alignItems: 'center' }}>
            <View style={{ width: '100%', maxWidth: 480 }}><TabBar tabs={[...TABS]} current={path} /></View>
          </View>
        </View>
      )}
    </Gate>
  );
}
