import { Image, Text, View } from 'react-native';
import { SignOutButton } from '@/lib/gate';
import { color, radius, space, text } from '@/theme';

// Top bar of the counter and back office: the mark, the place, who is signed in, and sign out.
export function DeskHeader({ title, name }: { title: string; name: string }) {
  return (
    <View style={{ backgroundColor: color.surface, paddingHorizontal: space[4], paddingTop: space[4] }}>
      <View style={{ width: '100%', maxWidth: 1080, alignSelf: 'center', flexDirection: 'row', alignItems: 'center',
        gap: space[3], padding: space[3], paddingLeft: space[4], borderRadius: radius.lg, backgroundColor: color.surfaceRaised,
        borderWidth: 2, borderColor: color.line }}>
        <Image source={require('../../assets/logo.png')} style={{ width: 40, height: 40 }} resizeMode="contain" accessibilityLabel="海豚云标志" />
        <Text style={{ ...text.heading, color: color.ink, flex: 1 }}>海豚云 · {title}</Text>
        <Text style={{ ...text.body, color: color.inkMuted }}>{name}</Text>
        <SignOutButton />
      </View>
    </View>
  );
}
