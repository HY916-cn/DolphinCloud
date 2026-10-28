import { useQuery } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { Gate, Shell } from '@/components';
import { saveRoster } from '@/lib/offline-queue';
import type { Me } from '@/lib/session';
import { supabase } from '@/lib/supabase';

// 柜台: the teller's five businesses. While online the roster is copied to this device for offline deposits.
export default function CounterLayout() {
  return <Gate allow={(me) => me.roles.includes('teller')}>{(me) => <Counter me={me} />}</Gate>;
}

function Counter({ me }: { me: Me }) {
  useQuery({
    queryKey: ['roster', me.profile.id],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('student_no,name,class_no,class_label,status');
      if (error) throw error;
      await saveRoster(me.profile.id, data);
      return data.length;
    },
  });
  return <Shell me={me}><Slot /></Shell>;
}
