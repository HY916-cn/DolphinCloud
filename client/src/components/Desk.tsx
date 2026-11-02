import type { ReactNode } from 'react';
import { useMe } from '@/lib/session';
import { Page } from './Shell';

// A back-office page: the title and who is signed in. A page's own actions open its content, in the row that counts
// what the page lists.
export function Desk({ title, back, children }: { title: string; back?: () => void; children: ReactNode }) {
  const me = useMe().data!;
  return (
    <Page title={title} sub={me.profile.display_name} back={back}>
      {children}
    </Page>
  );
}
