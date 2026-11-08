import { Slot } from 'expo-router';
import { useEffect } from 'react';
import { BookCover, BookShell, Gate } from '@/components';
import { studentView, useMe, useSession } from '@/lib/session';

// 存折版 (students only): the closed cover until a student opens it with 账号 and 密码, then the open 存折. Another
// login signed in here goes to its own pages.
export default function BookLayout() {
  const { session, ready } = useSession();
  const me = useMe();
  useEffect(() => {
    studentView('book');
    // Every part's page is loaded while the 存折 is closed, so it never opens or turns to an empty book.
    Promise.all([import('./index'), import('./txns'), import('./ranking'), import('./me')]).catch(() => {});
  }, []);
  if (!ready || !session || me.isPending) return <BookCover opening={!ready || !!session} />;
  return <Gate allow={(m) => !!m.student}>{() => <BookShell><Slot /></BookShell>}</Gate>;
}
