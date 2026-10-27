import { Slot } from 'expo-router';
import { DeskHeader } from '@/components/DeskHeader';
import { Gate } from '@/lib/gate';

// 后台: desktop browser; accountant, storekeeper, teacher and sysadmin.
export default function AdminLayout() {
  return (
    <Gate allow={(me) => me.roles.some((r) => r !== 'teller')}>
      {(me) => (<><DeskHeader title="后台" name={me.profile.display_name} /><Slot /></>)}
    </Gate>
  );
}
