import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';

// Toast (design system): one short result for 3 seconds. Rendered at the end of <body> in its own viewport-sized
// .dc-app, as ConfirmSheet is, so it stays in the viewport corner; the wrapper lets clicks through.
export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
    // Not onDone: it is a new function on every render and would restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return createPortal(
    <div className="dc-app" style={{ position: 'fixed', inset: 0, zIndex: 20, minHeight: 0, background: 'none', pointerEvents: 'none' }}>
      <div className="dc-toasts" role="status"><div className="dc-toast is-success"><Icon name="success" />{text}</div></div>
    </div>,
    document.body,
  );
}
