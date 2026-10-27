import { Text } from 'react-native';
import { Notice, Screen, ServiceTile, ServiceTiles } from '@/components';
import { useMe, type Role } from '@/lib/session';
import { color, text } from '@/theme';

// Back-office sections and who may open them (PHASE-1.md §4.2). The pages arrive with M4.
const SECTIONS: { icon: 'me' | 'teacher' | 'exchange' | 'coin' | 'passbook' | 'lock' | 'bell'; label: string; roles: Role[] }[] = [
  { icon: 'me', label: '学生', roles: ['teacher'] },
  { icon: 'teacher', label: '工作人员', roles: ['teacher', 'sysadmin'] },
  { icon: 'exchange', label: '商品', roles: ['storekeeper', 'teacher'] },
  { icon: 'coin', label: '发行', roles: ['teacher'] },
  { icon: 'passbook', label: '流水', roles: ['accountant', 'teacher'] },
  { icon: 'lock', label: '参数', roles: ['teacher'] },
  { icon: 'bell', label: '日志', roles: ['teacher', 'sysadmin'] },
];

export default function Admin() {
  const { roles } = useMe().data!;
  const mine = SECTIONS.filter((s) => s.roles.some((r) => roles.includes(r)));
  return (
    <Screen width={1080}>
      <Text role="heading" aria-level={1} style={{ ...text.title, color: color.ink }}>后台管理</Text>
      <Notice title="管理功能即将开放">以下是你的账号可以使用的管理功能，将在后续版本中逐项开放。</Notice>
      <ServiceTiles columns={4}>{mine.map((s) => <ServiceTile key={s.label} icon={s.icon} label={s.label} />)}</ServiceTiles>
    </Screen>
  );
}
