import { Slot } from 'expo-router';
import { useEffect } from 'react';
import { Gate, Shell } from '@/components';
import { studentView } from '@/lib/session';

export default function StudentLayout() {
  useEffect(() => { studentView('normal'); }, []);
  return <Gate allow={(me) => !!me.student}>{(me) => <Shell me={me}><Slot /></Shell>}</Gate>;
}
