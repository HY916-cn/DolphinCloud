import type { ReactNode } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { color, space } from '@/theme';

// A scrolling page on surface; phone screens are one 480px column, desk screens up to 1080px (design system layout).
// tabBar leaves room for the floating TabBar at the foot.
export function Screen({ children, width = 480, tabBar }: { children: ReactNode; width?: number; tabBar?: boolean }) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.surface }}
      contentContainerStyle={{ paddingHorizontal: space[4], paddingTop: space[6], paddingBottom: tabBar ? 120 : space[7] }}>
      <View style={{ width: '100%', maxWidth: width, alignSelf: 'center', gap: space[5] }}>{children}</View>
    </ScrollView>
  );
}

export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface }}>
      <ActivityIndicator color={color.dolphin} size="large" accessibilityLabel="正在加载" />
    </View>
  );
}
