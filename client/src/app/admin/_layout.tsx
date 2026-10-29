import { Redirect, Slot, usePathname } from 'expo-router';
import { Gate, SECTIONS, Shell } from '@/components';

// 后台: accountant, storekeeper, teacher and sysadmin; each section only for the roles that may open it.
export default function AdminLayout() {
  const path = usePathname();
  const section = SECTIONS.find((s) => path.startsWith(s.href));
  return (
    <Gate allow={(me) => me.roles.some((r) => r !== 'teller')}>
      {(me) => section && !section.roles.some((r) => me.roles.includes(r))
        ? <Redirect href="/admin" />
        : <Shell me={me}><Slot /></Shell>}
    </Gate>
  );
}
