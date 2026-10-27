import { useState } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';
import { color, font, radius, shadow, space } from '@/theme';
import { Icon, type IconName } from './Icon';

type Props = Omit<TextInputProps, 'style'> & { label: string; icon?: IconName; unit?: string; hint?: string; error?: string };

// dc-field: one large input at a time; an error turns the frame and hint danger and leads with the warning icon.
export function Field({ label, icon, unit, hint, error, onFocus, onBlur, ...input }: Props) {
  const [focused, setFocused] = useState(false);
  const message = error ?? hint;
  return (
    <View style={{ gap: space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        {icon && <Icon name={icon} size={32} />}
        <Text style={{ ...font(600), fontSize: 18, lineHeight: 28, color: color.ink }}>{label}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 64, paddingHorizontal: space[5],
        backgroundColor: color.surfaceRaised, borderWidth: 3, borderRadius: radius.md,
        borderColor: error ? color.danger : focused ? color.dolphinDeep : color.lineStrong,
        boxShadow: focused ? shadow.focusRing : undefined }}>
        <TextInput
          {...input}
          aria-label={label}
          aria-invalid={!!error}
          placeholderTextColor={color.inkMuted}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          style={{ flex: 1, minWidth: 0, height: '100%', ...font(700), fontSize: 24, color: color.ink,
            fontVariant: ['tabular-nums'], outlineStyle: 'none' } as object}
        />
        {unit && <Text style={{ ...font(600), fontSize: 16, lineHeight: 26, color: color.inkMuted }}>{unit}</Text>}
      </View>
      {message && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
          {error && <Icon name="warning" size={20} color={color.danger} />}
          <Text style={{ ...font(500), fontSize: 14, lineHeight: 20, color: error ? color.danger : color.inkMuted }}>{message}</Text>
        </View>
      )}
    </View>
  );
}
