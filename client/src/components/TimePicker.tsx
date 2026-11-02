import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './ui';

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

// TimePicker (design system): 24 hours in a 6 × 4 grid, then minutes in five-minute steps. A picked hour shows at
// once and moves to the minutes; a picked minute closes the panel. Values are "HH:MM"; with `placeholder` the field
// may stay empty and the footer can clear it. `rule` says what may be picked.
export function TimePicker({ label, value, onChange, rule, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; rule: string; placeholder?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const hours = useRef<HTMLDivElement>(null);
  const minutes = useRef<HTMLDivElement>(null);
  const [h, m] = value ? value.split(':') : ['', ''];
  const close = (focus = true) => { setOpen(false); if (focus) trigger.current?.focus(); };
  const focusIn = (group: HTMLDivElement | null) =>
    (group?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? group?.querySelector<HTMLButtonElement>('button'))?.focus();

  useEffect(() => {
    if (!open) return;
    focusIn(hours.current);
    const outside = (e: MouseEvent) => { if (!e.composedPath().includes(root.current!)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  function key(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 } as Record<string, number>)[e.key];
    const b = (e.target as HTMLElement).closest('.dc-time-opt');
    if (!step || !b) return;
    e.preventDefault();
    const list = [...b.parentElement!.children] as HTMLButtonElement[];
    list[list.indexOf(b as HTMLButtonElement) + step]?.focus();
  }

  return (
    <div className="dc-field dc-time" ref={root}>
      <label className="dc-field-label" htmlFor={id}><Icon name="clock" />{label}</label>
      <button ref={trigger} className="dc-date-trigger" id={id} type="button" aria-haspopup="dialog" aria-expanded={open}
        aria-controls={`${id}-pop`} onClick={() => (open ? close() : setOpen(true))}>
        <span style={value ? undefined : { color: 'var(--ink-muted)' }}>{value || placeholder}</span>
        <Icon name="clock" />
      </button>
      <div className="dc-cal" id={`${id}-pop`} role="dialog" aria-label={`选择${label}`} hidden={!open} onKeyDown={key}>
        <p className="dc-time-label" id={`${id}-h`}>时</p>
        <div className="dc-time-grid" role="group" aria-labelledby={`${id}-h`} ref={hours}>
          {HOURS.map((x) => (
            <button key={x} className="dc-time-opt" type="button" aria-label={`${Number(x)}时`} aria-pressed={x === h}
              onClick={() => { onChange(`${x}:${m || '00'}`); focusIn(minutes.current); }}>{x}</button>
          ))}
        </div>
        <p className="dc-time-label" id={`${id}-m`}>分</p>
        <div className="dc-time-grid" role="group" aria-labelledby={`${id}-m`} ref={minutes}>
          {MINUTES.map((x) => (
            <button key={x} className="dc-time-opt" type="button" aria-label={`${Number(x)}分`} aria-pressed={x === m}
              onClick={() => { onChange(`${h || '00'}:${x}`); close(); }}>{x}</button>
          ))}
        </div>
        <div className="dc-cal-foot">
          <span>{rule}</span>
          {placeholder && value && <button className="dc-btn dc-btn-ghost dc-btn-sm" type="button" onClick={() => { onChange(''); close(); }}>{placeholder}</button>}
        </div>
      </div>
    </div>
  );
}
