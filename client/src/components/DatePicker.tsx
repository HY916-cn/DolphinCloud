import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './ui';

// Dates are YYYY-MM-DD strings, so they compare as strings; the calendar works in UTC to stay off the device's zone.
const WEEK = '一二三四五六日';
const CAL = 320; // the calendar's least width, so its footer stays on one line
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const shift = (s: string, days: number) => iso(new Date(parse(s).getTime() + days * 86_400_000));
const weekday = (s: string) => WEEK[(parse(s).getUTCDay() + 6) % 7];
const monthOf = (s: string) => s.slice(0, 7);
const addMonths = (month: string, n: number) => {
  const d = parse(`${month}-01`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return monthOf(iso(d));
};
const parts = (s: string) => s.split('-').map(Number);
// Today in Asia/Shanghai, the school's day.
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
export const formatDate = (s: string) => { const [y, m, d] = parts(s); return `${y}年${m}月${d}日 星期${weekday(s)}`; };

// DatePicker (design system): a trigger that opens a month calendar, Monday first. `min`/`max` bound the days that
// can be picked; `rule` says why the others cannot. With `placeholder` the field may stay empty and the footer can
// clear it.
export function DatePicker({ label, value, onChange, min, max, rule, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; min?: string; max?: string; rule: string; placeholder?: string;
}) {
  const id = useId();
  const now = today();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthOf(value || now));
  const [focus, setFocus] = useState<string | null>(null);
  const [right, setRight] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const days = useRef<HTMLDivElement>(null);
  const allowed = (d: string) => (!min || d >= min) && (!max || d <= max);

  const close = () => { setOpen(false); trigger.current?.focus(); };
  const pick = (d: string) => { onChange(d); close(); };
  const show = () => {
    const start = [value, now, min].find((d) => d && allowed(d)) ?? max ?? now;
    setMonth(monthOf(start));
    setFocus(start);
    // In a narrow field the calendar is wider than the trigger; near the right edge it opens leftwards.
    setRight(root.current!.getBoundingClientRect().left + CAL > document.documentElement.clientWidth - 16);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  useEffect(() => {
    if (open && focus) days.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();
  }, [open, focus, month]);

  const [y, m] = parts(month);
  const first = `${month}-01`;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const list = Array.from({ length: count }, (_, i) => shift(first, i));

  function key(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
    const from = (e.target as HTMLElement).dataset.day;
    if (!step || !from) return;
    e.preventDefault();
    const to = shift(from, step);
    if (!allowed(to)) return;
    if (monthOf(to) === month) days.current?.querySelector<HTMLButtonElement>(`[data-day="${to}"]`)?.focus();
    else { setMonth(monthOf(to)); setFocus(to); }
  }

  return (
    <div className="dc-field dc-date" ref={root}>
      <label className="dc-field-label" htmlFor={id}><Icon name="calendar" />{label}</label>
      <button ref={trigger} className="dc-date-trigger" id={id} type="button" aria-haspopup="dialog" aria-expanded={open}
        aria-controls={`${id}-cal`} onClick={() => (open ? close() : show())}>
        <span style={value ? undefined : { color: 'var(--ink-muted)' }}>{value ? formatDate(value) : placeholder}</span>
        <Icon name="calendar" />
      </button>
      <div className="dc-cal" id={`${id}-cal`} role="dialog" aria-label={`选择${label}`} hidden={!open} onKeyDown={key}
        style={{ minWidth: `min(${CAL}px, calc(100vw - 32px))`, ...(right ? { left: 'auto', right: 0 } : null) }}>
        <div className="dc-cal-head">
          <button className="dc-cal-nav" type="button" aria-label="上个月" disabled={!!min && monthOf(min) >= month}
            onClick={() => setMonth(addMonths(month, -1))}><Icon name="back" /></button>
          <h3 className="dc-cal-title" aria-live="polite">{y}年{m}月</h3>
          <button className="dc-cal-nav" type="button" aria-label="下个月" disabled={!!max && monthOf(max) <= month}
            onClick={() => setMonth(addMonths(month, 1))}><Icon name="next" /></button>
        </div>
        <div className="dc-cal-grid">{[...WEEK].map((w) => <span key={w} className="dc-cal-week" aria-hidden="true">{w}</span>)}</div>
        <div className="dc-cal-grid dc-cal-days" ref={days}>
          {Array.from({ length: (parse(first).getUTCDay() + 6) % 7 }, (_, i) => <span key={`pad${i}`} />)}
          {list.map((d) => (
            <button key={d} data-day={d} className={`dc-cal-day ${d === now ? 'is-today' : ''}`} type="button"
              aria-label={`${m}月${parts(d)[2]}日 星期${weekday(d)}`} aria-pressed={d === value} disabled={!allowed(d)} onClick={() => pick(d)}>
              {parts(d)[2]}
            </button>
          ))}
        </div>
        <div className="dc-cal-foot">
          <span>{rule}</span>
          <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {placeholder && value && <button className="dc-btn dc-btn-ghost dc-btn-sm" type="button" onClick={() => pick('')}>{placeholder}</button>}
            <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" disabled={!allowed(now)} onClick={() => pick(now)}>今天</button>
          </span>
        </div>
      </div>
    </div>
  );
}
