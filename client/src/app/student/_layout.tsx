import { Slot } from 'expo-router';
import { Gate, Shell } from '@/components';

export default function StudentLayout() {
  return <Gate allow={(me) => !!me.student}>{(me) => <Shell me={me}><Slot /></Shell>}</Gate>;
}
