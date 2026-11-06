import { Slot } from 'expo-router';
import { useEffect } from 'react';
import { BookCover, BookShell, Gate, ShellLoading } from '@/components';
import { studentView, useSession } from '@/lib/session';

// 存折版 (students only): the closed cover until a student opens it with 账号 and 密码, then the open 存折. Another
// login signed in here goes to its own pages.
export default function BookLayout() {
  const { session, ready } = useSession();
  useEffect(() => { studentView('book'); }, []);
  if (!ready) return <ShellLoading />;
  if (!session) return <BookCover />;
  return <Gate allow={(me) => !!me.student}>{() => <BookShell><Slot /></BookShell>}</Gate>;
}
