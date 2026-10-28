import { Slot } from 'expo-router';
import { Gate, Shell } from '@/components';

// 柜台: logins with the teller role.
export default function CounterLayout() {
  return <Gate allow={(me) => me.roles.includes('teller')}>{(me) => <Shell me={me}><Slot /></Shell>}</Gate>;
}
