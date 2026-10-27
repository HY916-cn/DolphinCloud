import { Text, View } from 'react-native';
import { formatAmount } from '@/lib/format';
import { color, font, radius, space, text } from '@/theme';
import { Icon } from './Icon';
import { WaveDivider } from './WaveDivider';

// dc-balance: the one balance card on a screen; cloud-100 with waves along the foot.
export function BalanceCard({ amount, label = '我的海豚币', split = [] }: {
  amount: number;
  label?: string;
  split?: { label: string; value: string }[];
}) {
  return (
    <View style={{ overflow: 'hidden', backgroundColor: color.cloud100, borderRadius: radius.lg,
      paddingTop: space[5], paddingHorizontal: space[6], paddingBottom: 72 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Icon name="coin" size={36} />
        <Text style={{ ...text.heading, color: color.ink }}>{label}</Text>
      </View>
      <Text style={{ ...text.amount, color: color.ink, marginTop: space[3], marginBottom: space[2] }}>
        {formatAmount(amount)}
        <Text style={{ ...font(600), fontSize: 16, lineHeight: 26, color: color.inkMuted }}>{'  '}HTB</Text>
      </Text>
      {split.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {split.map((s) => (
            <Text key={s.label} style={{ ...text.caption, color: color.inkMuted, backgroundColor: color.surfaceRaised,
              borderRadius: radius.pill, paddingVertical: space[1], paddingHorizontal: space[3] }}>
              {s.label} <Text style={{ color: color.ink, ...font(700) }}>{s.value}</Text>
            </Text>
          ))}
        </View>
      )}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}><WaveDivider /></View>
    </View>
  );
}
