import { Slot } from 'expo-router';
import { Gate, Shell } from '@/components';
import { useRoster } from '@/lib/counter';
import type { Me } from '@/lib/session';

// 柜台: the teller's overview and five businesses. The roster is read on entry, for searching and offline deposits.
export default function CounterLayout() {
  return <Gate allow={(me) => me.roles.includes('teller')}>{(me) => <Counter me={me} />}</Gate>;
}

function Counter({ me }: { me: Me }) {
  useRoster(me.profile.id);
  return <Shell me={me}><Slot /></Shell>;
}
