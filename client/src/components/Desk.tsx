import type { ReactNode } from 'react';
import { useMe } from '@/lib/session';
import { Page } from './Shell';
import { Icon, link } from './ui';

// A back-office page: the title, who is signed in, page actions, and the switch to this device's other accounts.
export function Desk({ title, back, actions, children }: { title: string; back?: () => void; actions?: ReactNode; children: ReactNode }) {
  const me = useMe().data!;
  return (
    <Page title={title} sub={me.profile.display_name} back={back} actions={
      <>
        {actions}
        <a className="dc-icon-btn" aria-label="切换账号" {...link('/accounts')}><Icon name="me" /></a>
      </>
    }>
      {children}
    </Page>
  );
}
