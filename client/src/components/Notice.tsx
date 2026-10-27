import { Text, View } from 'react-native';
import { color, font, radius, space, text } from '@/theme';
import { Icon, type IconName } from './Icon';

const VARIANTS = {
  info: { bg: color.cloud100, border: color.line, accent: color.ink, icon: 'help' },
  success: { bg: color.successSoft, border: color.success, accent: color.success, icon: 'success' },
  danger: { bg: color.dangerSoft, border: color.danger, accent: color.danger, icon: 'warning' },
  coin: { bg: color.coinSoft, border: color.coin, accent: color.coinInk, icon: 'star' },
} as const;

// dc-notice: a result or something to note; title says what happened, text gives the numbers and the next step.
export function Notice({ variant = 'info', title, children, icon }: {
  variant?: keyof typeof VARIANTS; title: string; children?: string; icon?: IconName;
}) {
  const v = VARIANTS[variant];
  return (
    <View role={variant === 'danger' ? 'alert' : 'status'} style={{ flexDirection: 'row', alignItems: 'flex-start',
      gap: space[3], paddingVertical: space[4], paddingHorizontal: space[5], borderRadius: radius.md, borderWidth: 2,
      borderColor: v.border, backgroundColor: v.bg }}>
      <Icon name={icon ?? v.icon} size={36} color={variant === 'info' ? color.dolphin : v.accent} />
      <View style={{ flex: 1 }}>
        <Text style={{ ...text.body, ...font(700), color: v.accent }}>{title}</Text>
        {children ? <Text style={{ ...text.body, color: color.ink }}>{children}</Text> : null}
      </View>
    </View>
  );
}
