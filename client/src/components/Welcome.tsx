import type { FormEvent, ReactNode } from 'react';
import { LoginMore } from './Public';
import { Icon } from './ui';

// The sign-in look (LoginPage): the dolphin floating in sonar rings above a white shore, the panel rising from it.
// Used by every page shown before the app proper: sign in, set a new password, this device's accounts.
// more: 更多 in the top right corner, on the login page only.
export function Welcome({ label, onSubmit, more, children }: { label: string; onSubmit?: (e: FormEvent) => void; more?: boolean; children: ReactNode }) {
  const Panel = onSubmit ? 'form' : 'div';
  return (
    <div className="dc-app">
      <div className="dc-login">
        {more && <LoginMore />}
        <section className="dc-login-hero">
          <div className="dc-login-mark"><img src="/logo.png" alt="海豚云标志" /></div>
          <h1 className="dc-enter" style={{ '--i': 1 } as React.CSSProperties}>海豚云</h1>
          <p className="dc-enter" style={{ '--i': 2 } as React.CSSProperties}>明德实验学校海豚银行</p>
          <ul className="dc-login-points">
            <li><span><Icon name="query" /></span>随时查询余额与交易明细</li>
            <li><span><Icon name="coin" /></span>存款、取款、兑换在柜台一站办理</li>
            <li><span><Icon name="passbook" /></span>每一笔账目都有记录，可随时核对</li>
          </ul>
          <div className="dc-waves is-drifting is-shore" aria-hidden="true"><i /><i /><i /></div>
        </section>
        <Panel className="dc-login-panel" aria-label={label} noValidate={onSubmit ? true : undefined}
          onSubmit={onSubmit && ((e: FormEvent) => { e.preventDefault(); onSubmit(e); })}>
          {children}
        </Panel>
      </div>
    </div>
  );
}
