import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { formatAmount } from '@/lib/format';
import { findScopes, type Scope } from '@/lib/search';
import { useStudents } from '@/lib/students';
import { ListLoading } from './Skeleton';
import { Icon, type IconName } from './ui';

const SCOPE_ICON: Record<Scope['kind'], IconName> = { division: 'home', class: 'teacher', student: 'me' };

// 学生范围 on 流水 and 报表: the counter's search (姓名、拼音首字母、班级、学号) over the whole roster, which also offers
// a whole class or 学部. The chosen scope is a chip; clearing it is every student again. A student given only by
// number (?student= on 流水) is named once the roster is in.
export function ScopePicker({ value, onChange }: { value: Scope | null; onChange: (s: Scope | null) => void }) {
  const students = useStudents();
  const [query, setQuery] = useState('');
  const found = useMemo(() => findScopes(students.data?.index ?? [], query), [students.data, query]);
  const pick = (s: Scope | null) => { onChange(s); setQuery(''); };
  const row = value?.kind === 'student' ? students.data?.rows.find((r) => r.student_no === value.student_no) : undefined;
  const shown = row ? `${row.name} · ${row.class_label ?? `${row.class_no}班`} · 学号 ${row.student_no}` : value && `${value.label} · ${value.note}`;

  return (
    <div className="dc-field" role="group" aria-label="学生范围">
      <span className="dc-field-label"><Icon name="me" />学生范围</span>
      {value ? (
        <div className="dc-chips">
          <button className="dc-chip" type="button" aria-pressed="true" aria-label={`清除学生范围：${shown}`} onClick={() => pick(null)}>
            <Icon name="check" />{shown}
          </button>
          <button className="dc-btn dc-btn-ghost dc-btn-sm" type="button" onClick={() => pick(null)}>全部学生</button>
        </div>
      ) : (
        <>
          <label className="dc-search">
            <Icon name="query" />
            <input type="search" aria-label="搜索学生范围" placeholder="全部学生 · 输入姓名、拼音首字母、班级或学号" autoComplete="off"
              enterKeyHint="search" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (found.length === 1) pick(found[0]); } }} />
            {query && <button className="dc-search-clear" type="button" aria-label="清除" onClick={() => setQuery('')}><Icon name="close" /></button>}
          </label>
          {query.trim() && (students.isPending ? <ListLoading rows={2} label="正在加载名册" /> : found.length ? (
            <ul className="dc-list" aria-label="学生范围搜索结果">
              {found.map((s) => (
                <li key={`${s.kind}-${s.label}-${s.note}`}>
                  <a className="dc-list-link" href="#" onClick={(e) => { e.preventDefault(); pick(s); }}>
                    <span className="dc-list-icon"><Icon name={SCOPE_ICON[s.kind]} /></span>
                    <span>{s.kind === 'student' ? s.label : `${s.kind === 'class' ? '整个班级' : '整个学部'}：${s.label}`}
                      <small className="dc-top-sub">{s.note}</small></span>
                    <Icon name="next" />
                  </a>
                </li>
              ))}
            </ul>
          ) : <p className="dc-top-sub">没有找到「{query.trim()}」，换个写法试试：姓名、拼音首字母、班级或学号。</p>)}
        </>
      )}
    </div>
  );
}

// 时段: only the transactions made between two times of each day (the end is not included); empty is the whole day.
export function TimeRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const wrong = !!from && !!to && from >= to;
  return (
    <div className={`dc-field${wrong ? ' is-error' : ''}`} role="group" aria-label="每天的时段">
      <span className="dc-field-label"><Icon name="calendar" />每天的时段</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', maxWidth: 480 }}>
        <span className="dc-input-wrap" style={{ flex: 1, minWidth: 0 }}><input className="dc-input" type="time" style={{ minWidth: 0 }} aria-label="时段开始" value={from} onChange={(e) => onChange(e.target.value, to)} /></span>
        至
        <span className="dc-input-wrap" style={{ flex: 1, minWidth: 0 }}><input className="dc-input" type="time" style={{ minWidth: 0 }} aria-label="时段结束" value={to} onChange={(e) => onChange(from, e.target.value)} /></span>
      </span>
      <span className="dc-field-hint" role={wrong ? 'alert' : undefined}>
        {wrong ? '结束时间要晚于开始时间' : from || to ? `每天 ${from || '0:00'} 至 ${to || '24:00'}` : '全天'}
        {(from || to) && !wrong && (
          <button className="dc-btn dc-btn-ghost dc-btn-sm" type="button" style={{ minHeight: 0, paddingInline: 'var(--space-2)' }}
            onClick={() => onChange('', '')}>改为全天</button>
        )}
      </span>
    </div>
  );
}

// A figure: what it counts, the number, and a note under it.
export function Stats({ items }: { items: [string, ReactNode, string?][] }) {
  return (
    <div className="rp-stats">
      {items.map(([label, value, unit]) => (
        <div key={label} className="dc-card rp-stat"><span>{label}</span><b>{value}{unit && <small>{unit}</small>}</b></div>
      ))}
    </div>
  );
}

type Point = { label: string; value: number; tip: string };
const v = (value: number, max: number) => ({ '--v': max ? value / max : 0 }) as CSSProperties;

// Columns over time or another order (days, hours, balance bands): one series, the title names it.
export function Columns({ title, data, kind = '', unit }: { title: string; data: Point[]; kind?: string; unit: string }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  const every = Math.ceil(data.length / 7); // at most seven axis labels
  return (
    <figure className={`rp-chart ${kind}`}>
      <figcaption>{title}<small>最高 {formatAmount(max)} {unit}</small></figcaption>
      <div className="rp-cols" role="img" aria-label={`${title}：${data.map((d) => d.tip).join('；')}`}>
        {data.map((d) => <span key={d.label} className="rp-col" data-tip={d.tip} style={v(d.value, max)}><i /></span>)}
      </div>
      <div className="rp-axis" aria-hidden="true">{data.map((d, i) => <span key={d.label}>{i % every ? '' : d.label}</span>)}</div>
    </figure>
  );
}

// A line over the days (one series from a zero baseline): the area under it as a wash, the last value at its end,
// and each day's value on hover.
export function Line({ title, data, unit }: { title: string; data: Point[]; unit: string }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  const n = data.length;
  const y = (value: number) => 100 - (max ? (value / max) * 100 : 0);
  const points = data.map((d, i) => `${i + 0.5},${y(d.value)}`).join(' ');
  const every = Math.ceil(n / 7);
  return (
    <figure className="rp-chart">
      <figcaption>{title}<small>期末 {formatAmount(data.at(-1)?.value ?? 0)} {unit} · 最高 {formatAmount(max)} {unit}</small></figcaption>
      <div className="rp-cols rp-line" role="img" aria-label={`${title}：${data.map((d) => d.tip).join('；')}`}>
        <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
          <polygon points={`0.5,100 ${points} ${n - 0.5},100`} />
          <polyline points={points} />
        </svg>
        {data.map((d, i) => <span key={d.label} className={`rp-col${i === n - 1 ? ' is-end' : ''}`} data-tip={d.tip} style={v(d.value, max)}><i /></span>)}
      </div>
      <div className="rp-axis" aria-hidden="true">{data.map((d, i) => <span key={d.label}>{i % every ? '' : d.label}</span>)}</div>
    </figure>
  );
}

// Bars for named things (classes, tellers, products), longest first as given; the value is written at the bar's end.
export function Bars({ title, data, kind = '' }: { title: string; data: { label: string; value: number; text: string }[]; kind?: string }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  return (
    <figure className={`rp-chart ${kind}`}>
      <figcaption>{title}</figcaption>
      <dl className="rp-bars">
        {data.map((d) => (
          <div key={d.label}><dt title={d.label}>{d.label}</dt><dd><i style={v(d.value, max)} /><b>{d.text}</b></dd></div>
        ))}
      </dl>
    </figure>
  );
}

// A table of figures: text in the first column, numbers (right-aligned, with thousands separators and their sign) after it.
export function Table({ label, head, rows, foot }: { label: string; head: string[]; rows: (string | number | null)[][]; foot?: (string | number | null)[] }) {
  const cell = (c: string | number | null, i: number) => (
    <td key={i} className={typeof c === 'number' ? 'n' : undefined}>{c === null ? '—' : typeof c === 'number' ? `${c < 0 ? '−' : ''}${formatAmount(c)}` : c}</td>
  );
  return (
    <div className="rp-scroll">
      <table className="rp-table" aria-label={label}>
        <thead><tr>{head.map((h, i) => <th key={h} className={i ? 'n' : undefined} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map(cell)}</tr>)}</tbody>
        {foot && <tfoot><tr>{foot.map(cell)}</tr></tfoot>}
      </table>
    </div>
  );
}
