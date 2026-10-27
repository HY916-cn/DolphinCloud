import { Text } from 'react-native';
import { Notice, Screen, ServiceTile, ServiceTiles } from '@/components';
import { color, text } from '@/theme';

// The counter's five businesses, in SOP order. The flows themselves arrive with M3.
const SERVICES = [
  { icon: 'deposit', label: '存款' },
  { icon: 'withdraw', label: '取款' },
  { icon: 'exchange', label: '兑换', note: '文创好物' },
  { icon: 'query', label: '查询' },
  { icon: 'transfer', label: '冲正' },
] as const;

export default function Counter() {
  return (
    <Screen width={1080}>
      <Text role="heading" aria-level={1} style={{ ...text.title, color: color.ink }}>柜台业务</Text>
      <Notice title="办理功能即将开放">存款、取款、兑换、查询和冲正将在下一个版本中开放。</Notice>
      <ServiceTiles columns={4}>{SERVICES.map((s) => <ServiceTile key={s.label} {...s} />)}</ServiceTiles>
    </Screen>
  );
}
