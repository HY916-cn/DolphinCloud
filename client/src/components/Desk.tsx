import type { ReactNode } from 'react';
import { useMe } from '@/lib/session';
import { Page } from './Shell';
import { Icon, link } from './ui';

// A back-office page: the title, who is signed in, and the way to 我的. The title row holds only that link; a page's
// own actions open its content, in the row that counts what the page lists.
export function Desk({ title, back, children }: { title: string; back?: () => void; children: ReactNode }) {
  const me = useMe().data!;
  return (
    <Page title={title} sub={me.profile.display_name} back={back} actions={
      <a className="dc-icon-btn" aria-label="我的" {...link('/admin/me')}><Icon name="me" /></a>
    }>
      {children}
    </Page>
  );
}
