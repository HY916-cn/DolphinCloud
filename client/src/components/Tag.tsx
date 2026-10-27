import { Text, View } from 'react-native';
import { color, font, radius, space } from '@/theme';
import { Icon, type IconName } from './Icon';

const VARIANTS = {
  info: [color.cloud100, color.dolphinDeep],
  success: [color.successSoft, color.success],
  danger: [color.dangerSoft, color.danger],
  coin: [color.coinSoft, color.coinInk],
} as const;

// dc-tag: icon + a word or two; success and danger always carry their icon.
export function Tag({ variant = 'info', icon, label }: { variant?: keyof typeof VARIANTS; icon: IconName; label: string }) {
  const [bg, fg] = VARIANTS[variant];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: space[1], backgroundColor: bg,
      borderRadius: radius.sm, paddingVertical: space[1], paddingLeft: space[2], paddingRight: space[3] }}>
      <Icon name={icon} size={20} color={fg} />
      <Text style={{ ...font(600), fontSize: 14, lineHeight: 20, color: fg }}>{label}</Text>
    </View>
  );
}
