import { useEffect, useState } from 'react';
import { DatePicker, today } from './DatePicker';
import { TimeRange } from './Report';
import { Icon, type IconName } from './ui';

// The one filter bar of 流水, the counter's 查询 and the student's 明细 (PHASE-1.md §7.9): a search box, the days, the
// types, and a 时段 of each day only when asked for. A search with suggestions (`suggest`) turns what is picked into
// chips; without, the words themselves filter, a moment after typing stops.
export type Filter = { text: string; from: string; to: string; timeFrom: string; timeTo: string; kinds: string[] };
export const NO_FILTER: Filter = { text: '', from: '', to: '', timeFrom: '', timeTo: '', kinds: [] };
export const filtered = (f: Filter) => !!(f.text.trim() || f.from || f.to || f.timeFrom || f.timeTo || f.kinds.length);
export type Suggestion = { key: string; icon: IconName; label: string; note?: string; pick: () => void };
export type Chip = { key: string; label: string; clear: () => void };

export function FilterBar({ label, placeholder, value, onChange, kinds, suggest, chips = [] }: {
  label: string; placeholder: string; value: Filter; onChange: (f: Filter) => void; kinds?: readonly (readonly [string, string])[];
  suggest?: (text: string) => Suggestion[]; chips?: Chip[];
}) {
  const [text, setText] = useState(value.text);
  const [timed, setTimed] = useState(!!(value.timeFrom || value.timeTo));
  const set = (patch: Partial<Filter>) => onChange({ ...value, ...patch });
  const now = today();
  const found = suggest && text.trim() ? suggest(text.trim()) : [];
  useEffect(() => {
    if (suggest || text === value.text) return;
    const t = setTimeout(() => set({ text }), 300);
    return () => clearTimeout(t);
  }, [text, value]); // eslint-disable-line react-hooks/exhaustive-deps -- `set` and `suggest` change every render
  const pick = (s: Suggestion) => { s.pick(); setText(''); };
  const busy = chips.length > 0 || filtered(value);
  const toggle = (k: string) => set({ kinds: value.kinds.includes(k) ? value.kinds.filter((x) => x !== k) : [...value.kinds, k] });

  return (
    <form className="dc-card dc-stack fl-bar" role="search" aria-label={label} onSubmit={(e) => {
      e.preventDefault();
      if (found.length) pick(found[0]);
      else if (!suggest) set({ text });
    }}>
      <label className="dc-search">
        <Icon name="query" />
        <input type="search" aria-label={placeholder} placeholder={placeholder} autoComplete="off" enterKeyHint="search"
          value={text} onChange={(e) => setText(e.target.value)} />
        {text && <button className="dc-search-clear" type="button" aria-label="清除" onClick={() => { setText(''); if (!suggest) set({ text: '' }); }}><Icon name="close" /></button>}
      </label>
      {found.length > 0 && (
        <ul className="dc-list fl-found" aria-label="搜索建议">
          {found.map((s) => (
            <li key={s.key}>
              <a className="dc-list-link" href="#" onClick={(e) => { e.preventDefault(); pick(s); }}>
                <span className="dc-list-icon"><Icon name={s.icon} /></span>
                <span>{s.label}{s.note && <small className="dc-top-sub">{s.note}</small>}</span>
                <Icon name="next" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {suggest && text.trim() && !found.length && <p className="dc-top-sub">没有找到「{text.trim()}」。</p>}
      {chips.length > 0 && (
        <div className="dc-chips" role="group" aria-label="已选条件">
          {chips.map((c) => (
            <button key={c.key} className="dc-chip" type="button" aria-pressed="true" aria-label={`去掉条件：${c.label}`} onClick={c.clear}>
              <Icon name="check" />{c.label}<Icon name="close" />
            </button>
          ))}
        </div>
      )}
      <div className="fl-row">
        <span className="rp-pair fl-dates">
          <DatePicker short label="从" value={value.from} placeholder="不限" max={value.to || now} rule="不能晚于结束日期" onChange={(from) => set({ from })} />
          <DatePicker short label="到" value={value.to} placeholder="不限" min={value.from || undefined} max={now} rule="不能早于开始日期" onChange={(to) => set({ to })} />
        </span>
        {timed && <TimeRange from={value.timeFrom} to={value.timeTo} onChange={(timeFrom, timeTo) => set({ timeFrom, timeTo })} />}
      </div>
      <div className="fl-row">
        <div className="dc-chips" role="group" aria-label="类型">
          {kinds?.map(([k, name]) => (
            <button key={k} className="dc-chip" type="button" aria-pressed={value.kinds.includes(k)} onClick={() => toggle(k)}>
              <Icon name="check" />{name}
            </button>
          ))}
          <button className="dc-chip" type="button" aria-pressed={timed} onClick={() => { if (timed) set({ timeFrom: '', timeTo: '' }); setTimed(!timed); }}>
            <Icon name="check" />按时段
          </button>
        </div>
        {busy && (
          <button className="dc-btn dc-btn-ghost dc-btn-sm" type="button" onClick={() => { setText(''); setTimed(false); chips.forEach((c) => c.clear()); onChange(NO_FILTER); }}>
            清除条件
          </button>
        )}
      </div>
    </form>
  );
}
