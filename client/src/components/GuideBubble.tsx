import { Image, Text, View } from 'react-native';
import { color, font, radius, shadow, space, text } from '@/theme';
import { Button } from './Button';

// dc-guide: the logo as the speaker and a bubble whose lower-left corner is small, as if from the dolphin's mouth.
export function GuideBubble({ children, step, total, onNext }: {
  children: string; step?: number; total?: number; onNext?: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space[3] }}>
      <View style={{ width: 72, height: 72, borderRadius: radius.pill, backgroundColor: color.surfaceRaised,
        boxShadow: shadow.float, alignItems: 'center', justifyContent: 'center' }}>
        <Image source={require('../../assets/logo.png')} style={{ width: 60, height: 60 }} resizeMode="contain" />
      </View>
      <View role="dialog" aria-label="小海豚提示" style={{ flexShrink: 1, maxWidth: 420, paddingVertical: space[4],
        paddingHorizontal: space[5], backgroundColor: color.surfaceRaised, borderWidth: 2, borderColor: color.line,
        borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderBottomRightRadius: radius.lg,
        borderBottomLeftRadius: radius.sm, boxShadow: shadow.float }}>
        <Text style={{ ...text.body, ...font(700), color: color.dolphinDeep, marginBottom: space[1] }}>小海豚提示</Text>
        <Text style={{ ...text.body, color: color.ink }}>{children}</Text>
        {total ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], marginTop: space[3] }}>
            <Text style={{ ...text.caption, color: color.inkMuted }}>第 {step} 步，共 {total} 步</Text>
            <Button small label={step === total ? '完成' : '下一步'} onPress={onNext} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
