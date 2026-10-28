import { Desk, Notice } from '@/components';
import { useMe } from '@/lib/session';

// The counter's five businesses, in SOP order. The flows themselves arrive with M3.
export default function Counter() {
  return (
    <Desk me={useMe().data!} title="柜台业务"
      notice={<Notice title="办理功能即将开放">存款、取款、兑换、查询和冲正将在下一个版本中开放。</Notice>}
      tiles={[
        { icon: 'deposit', label: '存款' },
        { icon: 'withdraw', label: '取款' },
        { icon: 'exchange', label: '兑换', note: '文创好物' },
        { icon: 'query', label: '查询' },
        { icon: 'transfer', label: '冲正' },
      ]} />
  );
}
