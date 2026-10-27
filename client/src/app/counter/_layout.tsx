import { Slot } from 'expo-router';
import { DeskHeader } from '@/components/DeskHeader';
import { Gate } from '@/lib/gate';

// 柜台: tablet in landscape; only logins with the teller role.
export default function CounterLayout() {
  return (
    <Gate allow={(me) => me.roles.includes('teller')}>
      {(me) => (<><DeskHeader title="柜台" name={me.profile.display_name} /><Slot /></>)}
    </Gate>
  );
}
