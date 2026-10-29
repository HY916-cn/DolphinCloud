import type { ReactNode } from 'react';
import { useMe } from '@/lib/session';
import { Page } from './Shell';
import { Icon, link } from './ui';

// A back-office page: the title, who is signed in, and the switch to this device's other accounts. The title row
// holds only that switch; a page's own actions open its content, in the row that counts what the page lists.
export function Desk({ title, back, children }: { title: string; back?: () => void; children: ReactNode }) {
  const me = useMe().data!;
  return (
    <Page title={title} sub={me.profile.display_name} back={back} actions={
      <a className="dc-icon-btn" aria-label="切换账号" {...link('/accounts')}><Icon name="me" /></a>
    }>
      {children}
    </Page>
  );
}
