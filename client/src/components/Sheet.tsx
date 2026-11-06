import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { signOutCurrent } from '@/lib/accounts';

// Confirmation sheet (design system Sheet): rises from the foot on phones, a centred dialog on wider screens.
// Esc or a tap on the scrim cancels; closing plays the leaving animation before the sheet is removed. `children`
// holds the choices a confirmation needs (e.g. a reason); `ready` keeps the confirm button off until they are made.
// `alt` adds a second way to go on beside the confirm button (下载 PDF beside 打印).
export function ConfirmSheet({ title, text, confirm, cancel = '取消', ready = true, busy = false, alt, onConfirm, onClose, children }: {
  title: string; text: ReactNode; confirm: string; cancel?: string; ready?: boolean; busy?: boolean;
  alt?: { label: string; onClick: () => void }; onConfirm: () => void; onClose: () => void; children?: ReactNode;
}) {
  const [leaving, setLeaving] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setLeaving(true);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);
  // Rendered at the end of <body> in its own viewport-sized .dc-app: the page's .dc-app (container query) and
  // animated ancestors would otherwise hold the fixed scrim inside them.
  return createPortal(
    <div className="dc-app" style={{ position: 'fixed', inset: 0, zIndex: 10, minHeight: 0, background: 'none' }}>
    <div className={`dc-scrim ${leaving ? 'is-leaving' : ''}`} onClick={(e) => e.target === e.currentTarget && setLeaving(true)}
      onAnimationEnd={(e) => leaving && e.target === e.currentTarget && onClose()}>
      <div className="dc-sheet" role="dialog" aria-modal="true" aria-labelledby="dc-sheet-title">
        <h2 className="dc-sheet-title" id="dc-sheet-title">{title}</h2>
        <p className="dc-sheet-text">{text}</p>
        {children}
        <div className="dc-sheet-actions">
          <button ref={first} className="dc-btn dc-btn-secondary" type="button" onClick={() => setLeaving(true)}>{cancel}</button>
          {alt && <button className="dc-btn dc-btn-secondary" type="button" disabled={!ready || busy} onClick={alt.onClick}>{alt.label}</button>}
          <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button" disabled={!ready || busy} onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
    </div>,
    document.body,
  );
}

// Sign out after a confirmation, then 切换账号 (the login page with this device's accounts); `trigger` draws the
// control that opens the sheet.
export function SignOut({ trigger, to = '/login' }: { trigger: (open: () => void) => ReactNode; to?: '/login' | '/book' }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  return (
    <>
      {trigger(() => setOpen(true))}
      {open && (
        <ConfirmSheet title="退出登录" text="退出后，这台设备不再保存这个账号，下次使用需要重新输入密码。" confirm="退出登录"
          onClose={() => setOpen(false)}
          onConfirm={async () => {
            await signOutCurrent();
            queryClient.clear();
            router.replace(to);
          }} />
      )}
    </>
  );
}
