import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './ui';

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, m) => String(m).padStart(2, '0'));
const ROW = 44;

// TimePicker (design system): two scrolling wheels, hours 00–23 and minutes 00–59. The number that comes to rest in
// the middle band is the value, and a tapped number scrolls there. Values are "HH:MM"; with `placeholder` the field
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
  const pickHour = (x: string) => onChange(`${x}:${m || '00'}`);
  const pickMinute = (x: string) => onChange(`${h || '00'}:${x}`);

  useLayoutEffect(() => {
    if (!open) return;
    hours.current!.scrollTo({ top: Math.max(0, HOURS.indexOf(h)) * ROW, behavior: 'instant' });
    minutes.current!.scrollTo({ top: Math.max(0, MINUTES.indexOf(m)) * ROW, behavior: 'instant' });
    hours.current!.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!e.composedPath().includes(root.current!)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  function key(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.dc-time-opt');
    if (!b) return;
    const col = b.parentElement!;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const other = col === hours.current ? minutes.current : hours.current;
      other?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
      return;
    }
    const step = ({ ArrowUp: -1, ArrowDown: 1 } as Record<string, number>)[e.key];
    if (!step) return;
    e.preventDefault();
    const next = b[step < 0 ? 'previousElementSibling' : 'nextElementSibling'] as HTMLButtonElement | null;
    if (next) { next.click(); next.focus({ preventScroll: true }); }
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
        <div className="dc-time-heads" aria-hidden="true"><p className="dc-time-label">时</p><p className="dc-time-label">分</p></div>
        <div className="dc-time-wheels">
          <Wheel ref={hours} name="时" items={HOURS} current={h} onPick={pickHour} />
          <span className="dc-time-sep" aria-hidden="true">:</span>
          <Wheel ref={minutes} name="分" items={MINUTES} current={m} onPick={pickMinute} />
        </div>
        <div className="dc-cal-foot">
          <span>{rule}</span>
          <span className="dc-time-acts">
            {placeholder && value && <button className="dc-btn dc-btn-ghost dc-btn-sm" type="button" onClick={() => { onChange(''); close(); }}>{placeholder}</button>}
            <button className="dc-btn dc-btn-primary dc-btn-sm" type="button" onClick={() => close()}>确定</button>
          </span>
        </div>
      </div>
    </div>
  );
}

// One wheel. Scrolling snaps by row; once it has rested for a moment the number in the band is picked.
function Wheel({ ref, name, items, current, onPick }: {
  ref: React.RefObject<HTMLDivElement | null>; name: string; items: string[]; current: string; onPick: (x: string) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const settle = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const x = items[Math.round(ref.current!.scrollTop / ROW)];
      // an empty field shows the first row without having picked it
      if (x && x !== (current || items[0])) onPick(x);
    }, 120);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="dc-time-col" role="group" aria-label={name} ref={ref} onScroll={settle}>
      {items.map((x, i) => (
        <button key={x} className="dc-time-opt" type="button" aria-label={`${Number(x)}${name}`} aria-pressed={x === current}
          onClick={() => { onPick(x); ref.current!.scrollTo({ top: i * ROW }); }}>{x}</button>
      ))}
    </div>
  );
}
