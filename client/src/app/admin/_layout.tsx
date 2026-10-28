import { Slot } from 'expo-router';
import { Gate, Shell } from '@/components';

// 后台: accountant, storekeeper, teacher and sysadmin.
export default function AdminLayout() {
  return <Gate allow={(me) => me.roles.some((r) => r !== 'teller')}>{(me) => <Shell me={me}><Slot /></Shell>}</Gate>;
}
