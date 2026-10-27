import { Text, View } from 'react-native';
import { Screen } from '@/components';
import { SignOutButton } from '@/lib/gate';
import { useMe } from '@/lib/session';
import { color, radius, space, text } from '@/theme';

// 我的: who is signed in; the grade and class lead, the cohort follows quietly.
export default function StudentMe() {
  const { student } = useMe().data!;
  const s = student!;
  return (
    <Screen tabBar>
      <Text role="heading" aria-level={1} style={{ ...text.title, color: color.ink }}>我的</Text>
      <View style={{ gap: space[1], padding: space[5], borderRadius: radius.lg, backgroundColor: color.surfaceRaised,
        borderWidth: 2, borderColor: color.line }}>
        <Text style={{ ...text.heading, color: color.ink }}>{s.name}</Text>
        <Text style={{ ...text.bodyLg, color: color.ink }}>
          {s.class_label ?? `${s.class_no} 班`}
          <Text style={{ ...text.caption, color: color.inkMuted }}>{'  '}{s.cohort} 届</Text>
        </Text>
        <Text style={{ ...text.body, color: color.inkMuted }}>学号 {s.student_no}</Text>
      </View>
      <Text style={{ ...text.body, color: color.inkMuted }}>需要更换密码时，请联系老师重置。</Text>
      <SignOutButton />
    </Screen>
  );
}
