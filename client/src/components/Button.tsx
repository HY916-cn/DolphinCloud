import { Pressable, Text } from 'react-native';
import { color, font, radius, shadow, space } from '@/theme';
import { Icon, type IconName } from './Icon';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  small?: boolean;
  icon?: IconName;
  disabled?: boolean;
};

// dc-btn: 56px (44px small) pill; the primary sits on a 5px dolphin-deep base and sinks 3px when pressed.
export function Button({ label, onPress, variant = 'primary', small, icon, disabled }: Props) {
  const fg = disabled ? color.inkMuted : variant === 'primary' ? color.onDolphin : color.dolphinDeep;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={(state) => {
        const { pressed } = state;
        return {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: 'flex-start',
          gap: space[2],
          minHeight: small ? 44 : 56,
          paddingHorizontal: variant === 'ghost' ? space[4] : small ? space[5] : space[6],
          borderWidth: 3,
          borderColor: variant === 'secondary' && !disabled ? color.lineStrong : 'transparent',
          borderRadius: radius.pill,
          marginBottom: variant === 'primary' ? 5 : 0,
          backgroundColor: disabled
            ? color.cloud200
            : variant === 'primary'
              ? color.dolphin
              : variant === 'secondary'
                ? pressed ? color.cloud100 : color.surfaceRaised
                : pressed ? color.cloud100 : 'transparent',
          boxShadow: variant === 'primary' && !disabled ? (pressed ? `0 2px 0 ${color.dolphinDeep}` : shadow.button) : undefined,
          transform: [{ translateY: pressed && variant === 'primary' && !disabled ? 3 : 0 }],
          cursor: disabled ? 'auto' : 'pointer',
        };
      }}
    >
      {icon && <Icon name={icon} size={small ? 24 : 26} color={fg} />}
      <Text style={{ ...font(600), fontSize: small ? 16 : 18, lineHeight: small ? 26 : 28, color: fg }}>{label}</Text>
    </Pressable>
  );
}
