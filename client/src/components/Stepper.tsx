import { Icon } from './ui';

// A whole number with its allowed range; an empty or out-of-range one is marked and never sent.
export type Range = { min: number; max: number };
export const outside = (value: string, { min, max }: Range) => value === '' || Number(value) < min || Number(value) > max;
const digits = (v: string) => v.replace(/\D/g, '').slice(0, 7);

// QtyStepper control (design system): minus, the number (typed or stepped) and plus; the buttons keep within the range.
// `invalid` marks a number in range that is wrong against another one.
export function Stepper({ label, value, onChange, step, range, invalid }: {
  label: string; value: string; onChange: (v: string) => void; step: number; range: Range; invalid?: boolean;
}) {
  const n = Number(value);
  const { min, max } = range;
  const to = (v: number) => onChange(String(Math.min(max, Math.max(min, v))));
  return (
    <div className={`dc-qty-ctrl ${invalid || outside(value, range) ? 'is-error' : ''}`}>
      <button className="dc-qty-btn" type="button" aria-label={`${label}减少 ${step}`} disabled={n <= min} onClick={() => to(n - step)}><Icon name="minus" /></button>
      <input className="dc-qty-input" inputMode="numeric" aria-label={label} value={value} onChange={(e) => onChange(digits(e.target.value))} />
      <button className="dc-qty-btn" type="button" aria-label={`${label}增加 ${step}`} disabled={n >= max} onClick={() => to(n + step)}><Icon name="plus" /></button>
    </div>
  );
}
