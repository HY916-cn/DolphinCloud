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
// For two pickers side by side: the year only when it is not this one, and 周 for 星期.
const shortDate = (s: string) => { const [y, m, d] = parts(s); return `${String(y) === today().slice(0, 4) ? '' : `${y}年`}${m}月${d}日 周${weekday(s)}`; };

// DatePicker (design system): a trigger that opens a month calendar, Monday first; its title opens a month panel
// to jump by year. `min`/`max` bound the days that can be picked; `rule` says why the others cannot. With
// `placeholder` the field may stay empty and the footer can clear it. `shown` replaces the date on the trigger (a
// week), `short` shows it briefly (two pickers side by side), and `bare` leaves the label to screen readers. `locked`
// keeps the date as it is and says why; `error` marks the field with what is wrong.
export function DatePicker({ label, value, onChange, min, max, rule, placeholder, shown, bare, short, locked, error }: {
  label: string; value: string; onChange: (v: string) => void; min?: string; max?: string; rule: string; placeholder?: string;
  shown?: string; bare?: boolean; short?: boolean; locked?: string; error?: string;
}) {
  const id = useId();
  const now = today();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthOf(value || now));
  const [months, setMonths] = useState(false);
  const [focus, setFocus] = useState<string | null>(null); // a day YYYY-MM-DD, or a month YYYY-MM in the month panel
  const [right, setRight] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const days = useRef<HTMLDivElement>(null);
  const cal = useRef<HTMLDivElement>(null);
  const back = useRef(month); // the days shown before the month panel opened, for Esc
  const allowed = (d: string) => (!min || d >= min) && (!max || d <= max);
  const monthAllowed = (mo: string) => (!min || mo >= monthOf(min)) && (!max || mo <= monthOf(max));
  const fit = (mo: string) => (max && mo > monthOf(max) ? monthOf(max) : min && mo < monthOf(min) ? monthOf(min) : mo);
  // The day to focus in an allowed month: the chosen day or today when they are in it, else its first allowed day.
  const dayIn = (mo: string) => [value, now].find((d) => d && monthOf(d) === mo && allowed(d)) ?? (min && monthOf(min) === mo ? min : `${mo}-01`);
  const showDays = (mo: string) => { setMonths(false); setMonth(mo); setFocus(dayIn(mo)); };
  const toggleMonths = () => {
    if (months) { showDays(month); return; }
    back.current = month;
    setMonths(true);
    setFocus(month);
  };

  const close = () => { setOpen(false); trigger.current?.focus(); };
  const pick = (d: string) => { onChange(d); close(); };
  const show = () => {
    const start = [value, now, min].find((d) => d && allowed(d)) ?? max ?? now;
    setMonth(monthOf(start));
    setFocus(start);
    setMonths(false);
    // In a narrow field the calendar is wider than the trigger; near the right edge it opens leftwards.
    setRight(root.current!.getBoundingClientRect().left + CAL > document.documentElement.clientWidth - 16);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    // composedPath, since a re-render may have detached the clicked button from the page.
    const outside = (e: MouseEvent) => { if (!e.composedPath().includes(root.current!)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  useEffect(() => {
    if (open && focus) cal.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"], [data-month="${focus}"]`)?.focus();
  }, [open, focus, month, months]);

  const [y, m] = parts(month);
  const first = `${month}-01`;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const list = Array.from({ length: count }, (_, i) => shift(first, i));

  function key(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); if (months) showDays(back.current); else close(); return; }
    const { day: from, month: fromMonth } = (e.target as HTMLElement).dataset;
    if (fromMonth) {
      const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 } as Record<string, number>)[e.key];
      if (!step) return;
      e.preventDefault();
      const to = addMonths(fromMonth, step);
      if (!monthAllowed(to)) return;
      if (to.slice(0, 4) === month.slice(0, 4)) cal.current?.querySelector<HTMLButtonElement>(`[data-month="${to}"]`)?.focus();
      else { setMonth(to); setFocus(to); }
      return;
    }
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
    if (!step || !from) return;
    e.preventDefault();
    const to = shift(from, step);
    if (!allowed(to)) return;
    if (monthOf(to) === month) days.current?.querySelector<HTMLButtonElement>(`[data-day="${to}"]`)?.focus();
    else { setMonth(monthOf(to)); setFocus(to); }
  }

  return (
    <div className={`dc-field dc-date${bare ? ' is-bare' : ''}${error ? ' is-error' : ''}`} ref={root}>
      <label className={bare ? 'dc-sr-only' : 'dc-field-label'} htmlFor={id}>{!bare && <Icon name="calendar" />}{label}</label>
      <button ref={trigger} className="dc-date-trigger" id={id} type="button" aria-haspopup="dialog" aria-expanded={open}
        aria-controls={`${id}-cal`} disabled={!!locked} onClick={() => (open ? close() : show())}>
        <span style={value ? undefined : { color: 'var(--ink-muted)' }}>{shown ?? (value ? (short ? shortDate(value) : formatDate(value)) : placeholder)}</span>
        <Icon name={locked ? 'lock' : 'calendar'} />
      </button>
      {(error || locked) && <span className="dc-field-hint">{error ? <><Icon name="warning" />{error}</> : locked}</span>}
      <div ref={cal} className={`dc-cal ${months ? 'is-months' : ''}`} id={`${id}-cal`} role="dialog" aria-label={`选择${label}`} hidden={!open} onKeyDown={key}
        style={{ minWidth: `min(${CAL}px, calc(100vw - 32px))`, ...(right ? { left: 'auto', right: 0 } : null) }}>
        <div className="dc-cal-head">
          <button className="dc-cal-nav" type="button" aria-label={months ? '上一年' : '上个月'}
            disabled={!!min && (months ? min.slice(0, 4) >= month.slice(0, 4) : monthOf(min) >= month)}
            onClick={() => setMonth(months ? fit(addMonths(month, -12)) : addMonths(month, -1))}><Icon name="back" /></button>
          <button className="dc-cal-title" type="button" aria-label="选择年月" aria-expanded={months} onClick={toggleMonths}>
            {y}年{months ? '' : `${m}月`}<Icon name="expand" />
          </button>
          <button className="dc-cal-nav" type="button" aria-label={months ? '下一年' : '下个月'}
            disabled={!!max && (months ? max.slice(0, 4) <= month.slice(0, 4) : monthOf(max) <= month)}
            onClick={() => setMonth(months ? fit(addMonths(month, 12)) : addMonths(month, 1))}><Icon name="next" /></button>
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
        <div className="dc-cal-months">
          {Array.from({ length: 12 }, (_, i) => {
            const mo = `${y}-${String(i + 1).padStart(2, '0')}`;
            return (
              <button key={i} data-month={mo} className={`dc-cal-month ${mo === monthOf(now) ? 'is-today' : ''}`} type="button"
                aria-label={`${y}年${i + 1}月`} aria-pressed={!!value && mo === monthOf(value)} disabled={!monthAllowed(mo)}
                onClick={() => showDays(mo)}>{i + 1}月</button>
            );
          })}
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
