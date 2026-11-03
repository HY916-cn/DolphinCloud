import { Redirect, Slot, usePathname } from 'expo-router';
import { Gate, SECTIONS, Shell } from '@/components';
import { managesLogins } from '@/lib/session';

// Pages that only manage logins, which is not the president's.
const LOGINS = ['/admin/students/import', '/admin/staff/new'];

// 后台: accountant, storekeeper, president, teacher and sysadmin; each section only for the roles that may open it.
export default function AdminLayout() {
  const path = usePathname();
  const section = SECTIONS.find((s) => path.startsWith(s.href));
  return (
    <Gate allow={(me) => me.roles.some((r) => r !== 'teller')}>
      {(me) => (section && !section.roles.some((r) => me.roles.includes(r))) || (!managesLogins(me) && LOGINS.some((p) => path.startsWith(p)))
        ? <Redirect href="/admin" />
        : <Shell me={me}><Slot /></Shell>}
    </Gate>
  );
}
