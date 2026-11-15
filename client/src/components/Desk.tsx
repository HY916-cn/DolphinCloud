import type { ReactNode } from 'react';
import { useMe } from '@/lib/session';
import { Page } from './Shell';

// A back-office page: the title and who is signed in. A page's own actions open its content, in the row that counts
// what the page lists; `actions` sits at the right of the title (the page's main action on a wide screen).
export function Desk({ title, back, actions, children }: { title: string; back?: () => void; actions?: ReactNode; children: ReactNode }) {
  const me = useMe().data!;
  return (
    <Page title={title} sub={me.profile.display_name} back={back} actions={actions}>
      {children}
    </Page>
  );
}
