import { Desk, Notice, type IconName } from '@/components';
import { useMe, type Role } from '@/lib/session';

// Back-office sections and who may open them (PHASE-1.md §4.2). The pages arrive with M4.
const SECTIONS: { icon: IconName; label: string; roles: Role[] }[] = [
  { icon: 'me', label: '学生', roles: ['teacher'] },
  { icon: 'teacher', label: '工作人员', roles: ['teacher', 'sysadmin'] },
  { icon: 'exchange', label: '商品', roles: ['storekeeper', 'teacher'] },
  { icon: 'coin', label: '发行', roles: ['teacher'] },
  { icon: 'passbook', label: '流水', roles: ['accountant', 'teacher'] },
  { icon: 'settings', label: '参数', roles: ['teacher'] },
  { icon: 'bell', label: '日志', roles: ['teacher', 'sysadmin'] },
];

export default function Admin() {
  const me = useMe().data!;
  return (
    <Desk me={me} title="后台管理"
      notice={<Notice title="管理功能即将开放">以下是你的账号可以使用的管理功能，将在后续版本中逐项开放。</Notice>}
      tiles={SECTIONS.filter((s) => s.roles.some((r) => me.roles.includes(r)))} />
  );
}
