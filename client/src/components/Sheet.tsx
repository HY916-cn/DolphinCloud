import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { signOutCurrent } from '@/lib/accounts';

// Tab and Shift+Tab stay in the sheet: from its last control to its first and back, and in again if focus got out. Of
// a radio group only the checked one takes a Tab.
function keepTab(e: KeyboardEvent, sheet: HTMLElement) {
  const controls = [...sheet.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
    .filter((el) => el.offsetParent && !(el.matches('input[type="radio"]:not(:checked)') && sheet.querySelector('input[type="radio"]:checked')));
  const [to, edge] = e.shiftKey ? [controls.at(-1), controls[0]] : [controls[0], controls.at(-1)];
  if (!sheet.contains(document.activeElement) || document.activeElement === edge) {
    e.preventDefault();
    to?.focus();
  }
}

// Everyone a batch confirmation reaches (design system Sheet): name and number, scrolling in its box past five rows.
// Also what still holds something up, each with how it stands, under its own `label`.
export function SheetList({ people, label = '本次涉及' }: { people: [string, string][]; label?: string }) {
  return <ul className="dc-sheet-list" tabIndex={0} aria-label={label}>{people.map(([name, no], i) => <li key={i}><b>{name}</b><small>{no}</small></li>)}</ul>;
}

// Confirmation sheet (design system Sheet): rises from the foot on phones, a centred dialog on wider screens.
// Esc or a tap on the scrim cancels; closing plays the leaving animation before the sheet is removed. `children`
// holds the choices a confirmation needs (e.g. a reason); `ready` keeps the confirm button off until they are made.
// Focus starts on the first button, stays in the sheet, and goes back to what opened it when the sheet is gone.
// `alt` adds a second way to go on beside the confirm button (下载 PDF beside 打印); `cancel={null}` leaves the
// confirm button alone (知道了).
export function ConfirmSheet({ title, text, confirm, cancel = '取消', ready = true, busy = false, alt, onConfirm, onClose, children }: {
  title: string; text?: ReactNode; confirm: string; cancel?: string | null; ready?: boolean; busy?: boolean;
  alt?: { label: string; onClick: () => void }; onConfirm: () => void; onClose: () => void; children?: ReactNode;
}) {
  const [leaving, setLeaving] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    first.current?.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLeaving(true);
      if (e.key === 'Tab') keepTab(e, sheet.current!);
    };
    document.addEventListener('keydown', keys);
    return () => {
      document.removeEventListener('keydown', keys);
      opener?.focus();
    };
  }, []);
  // Rendered at the end of <body> in its own viewport-sized .dc-app: the page's .dc-app (container query) and
  // animated ancestors would otherwise hold the fixed scrim inside them.
  return createPortal(
    <div className="dc-app" style={{ position: 'fixed', inset: 0, zIndex: 10, minHeight: 0, background: 'none' }}>
    <div className={`dc-scrim ${leaving ? 'is-leaving' : ''}`} onClick={(e) => e.target === e.currentTarget && setLeaving(true)}
      onAnimationEnd={(e) => leaving && e.target === e.currentTarget && onClose()}>
      <div ref={sheet} className="dc-sheet" role="dialog" aria-modal="true" aria-labelledby="dc-sheet-title">
        <h2 className="dc-sheet-title" id="dc-sheet-title">{title}</h2>
        {text && <p className="dc-sheet-text">{text}</p>}
        {children}
        <div className="dc-sheet-actions">
          {cancel !== null && <button ref={first} className="dc-btn dc-btn-secondary" type="button" onClick={() => setLeaving(true)}>{cancel}</button>}
          {alt && <button className="dc-btn dc-btn-secondary" type="button" disabled={!ready || busy} onClick={alt.onClick}>{alt.label}</button>}
          <button ref={cancel === null ? first : undefined} className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button" disabled={!ready || busy} onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
    </div>,
    document.body,
  );
}

// Sign out after a confirmation, then 切换账号 (the login page with this device's accounts); `trigger` draws the
// control that opens the sheet, and `before` runs first with the sign-out to call when it is done (the 存折 closing).
export function SignOut({ trigger, to = '/login', before }: {
  trigger: (open: () => void) => ReactNode; to?: '/login' | '/book'; before?: (then: () => Promise<void>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  return (
    <>
      {trigger(() => setOpen(true))}
      {open && (
        <ConfirmSheet title="退出登录" text="退出后，这台设备不再保存这个账号，下次使用需要重新输入密码。" confirm="退出登录"
          onClose={() => setOpen(false)}
          onConfirm={async () => {
            const leave = async () => {
              await signOutCurrent();
              queryClient.clear();
              router.replace(to);
            };
            if (before) { setOpen(false); await before(leave); } else await leave();
          }} />
      )}
    </>
  );
}
