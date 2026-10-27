import { Text, View } from 'react-native';
import { color, font, radius, space, text } from '@/theme';

// dc-steps: done steps are solid dolphin with ✓, the current one larger on cloud-100; connectors turn blue when done.
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <View accessibilityRole="list" style={{ flexDirection: 'row' }}>
      {steps.map((name, i) => {
        const done = i < current;
        const now = i === current;
        const size = now ? 48 : 40;
        return (
          <View key={name} accessibilityRole="listitem" aria-current={now ? 'step' : undefined}
            style={{ flex: 1, alignItems: 'center', gap: space[2] }}>
            {i > 0 && (
              <View style={{ position: 'absolute', top: 17, height: 6, left: '-50%', right: '50%', marginLeft: 28,
                marginRight: 28, borderRadius: radius.pill, backgroundColor: done || now ? color.dolphin : color.cloud200 }} />
            )}
            <View style={{ width: size, height: size, marginVertical: now ? -4 : 0, borderRadius: radius.pill, borderWidth: 3,
              alignItems: 'center', justifyContent: 'center',
              borderColor: done ? color.dolphin : now ? color.dolphinDeep : color.lineStrong,
              backgroundColor: done ? color.dolphin : now ? color.cloud100 : color.surfaceRaised }}>
              <Text style={{ ...font(700), fontSize: now ? 20 : 16, lineHeight: now ? 24 : 20,
                color: done ? color.onDolphin : now ? color.dolphinDeep : color.inkMuted }}>{done ? '✓' : i + 1}</Text>
            </View>
            <Text style={{ ...text.caption, ...(now ? font(700) : {}), color: now ? color.ink : color.inkMuted, textAlign: 'center' }}>
              {name}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
