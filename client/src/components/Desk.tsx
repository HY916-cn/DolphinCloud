import type { ReactNode } from 'react';
import type { Me } from '@/lib/session';
import { Page } from './Shell';
import { SignOut } from './Sheet';
import { Icon, type IconName } from './ui';

// A desk landing page (counter, back office): who is signed in, sign out, and the desk's businesses as tiles.
export function Desk({ me, title, notice, tiles }: {
  me: Me; title: string; notice: ReactNode; tiles: { icon: IconName; label: string; note?: string }[];
}) {
  return (
    <Page title={title} sub={me.profile.display_name} actions={
      <SignOut trigger={(open) => (
        <button className="dc-icon-btn" type="button" aria-label="退出登录" onClick={open}><Icon name="logout" /></button>
      )} />
    }>
      <div className="dc-enter">{notice}</div>
      <div className="dc-tiles dc-enter" style={{ '--i': 1 } as React.CSSProperties}>
        {tiles.map((t) => (
          <div key={t.label} className="dc-tile">
            <span className="dc-tile-icon"><Icon name={t.icon} /></span>{t.label}{t.note && <small>{t.note}</small>}
          </div>
        ))}
      </div>
    </Page>
  );
}
