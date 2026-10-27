import { Text, View } from 'react-native';
import { formatSigned } from '@/lib/format';
import { color, font, radius, space, text } from '@/theme';
import { Icon, type IconName } from './Icon';

export type Txn = { key: string; icon: IconName; title: string; time: string; amount: number; note: string };

// dc-txns: each row has an icon, "业务 · 详情", time and a signed amount with a word for its direction.
export function TxnList({ items }: { items: Txn[] }) {
  return (
    <View accessibilityRole="list" style={{ backgroundColor: color.surfaceRaised, borderRadius: radius.lg, borderWidth: 2,
      borderColor: color.line, paddingVertical: space[2], paddingHorizontal: space[4] }}>
      {items.map((t, i) => (
        <View key={t.key} accessibilityRole="listitem" style={{ flexDirection: 'row', alignItems: 'center', gap: space[3],
          paddingVertical: space[3], borderTopWidth: i ? 2 : 0, borderStyle: 'dashed', borderColor: color.line }}>
          <View style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: color.cloud100,
            alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={t.icon} size={36} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ ...font(600), fontSize: 16, lineHeight: 26, color: color.ink }}>{t.title}</Text>
            <Text style={{ ...text.caption, color: color.inkMuted }}>{t.time}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ ...font(800), fontSize: 20, lineHeight: 28, fontVariant: ['tabular-nums'],
              color: t.amount > 0 ? color.success : color.ink }}>{formatSigned(t.amount)}</Text>
            <Text style={{ ...text.caption, color: color.inkMuted }}>{t.note}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
