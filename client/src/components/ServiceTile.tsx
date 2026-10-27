import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { color, font, radius, shadow, space } from '@/theme';
import { Icon, type IconName } from './Icon';

// dc-tiles: as many 132px-minimum columns as fit (or a fixed count, e.g. 4 on the counter); tiles in a row share widths and heights.
export function ServiceTiles({ columns, children }: { columns?: number; children: ReactNode[] }) {
  const [width, setWidth] = useState(0);
  const gap = space[4];
  const cols = columns ?? Math.max(1, Math.floor((width + gap) / (132 + gap)));
  const tile = width ? (width - gap * (cols - 1)) / cols : 0;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {width > 0 && children.map((c, i) => <View key={i} style={{ width: tile }}>{c}</View>)}
    </View>
  );
}

// dc-tile: a large icon on cloud-100 and a business name of up to four characters, with an optional note.
export function ServiceTile({ icon, label, note, onPress }: { icon: IconName; label: string; note?: string; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole="button" aria-label={note ? `${label}，${note}` : label} onPress={onPress}
      style={(state) => {
        const { pressed } = state;
        return {
          flexGrow: 1, alignItems: 'center', gap: space[2], paddingTop: space[5], paddingHorizontal: space[3], paddingBottom: space[4],
          backgroundColor: color.surfaceRaised, borderWidth: 2, borderColor: color.line, borderRadius: radius.lg,
          boxShadow: pressed ? `0 2px 0 ${color.line}` : shadow.card,
          transform: [{ translateY: pressed ? 4 : 0 }],
        };
      }}>
      <View style={{ width: 80, height: 80, borderRadius: radius.lg, backgroundColor: color.cloud100,
        alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={52} />
      </View>
      <Text style={{ ...font(600), fontSize: 18, lineHeight: 28, color: color.ink }}>{label}</Text>
      {note && <Text style={{ ...font(500), fontSize: 14, lineHeight: 20, color: color.inkMuted, marginTop: -space[2] }}>{note}</Text>}
    </Pressable>
  );
}
