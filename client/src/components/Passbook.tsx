import { useId, type ReactNode } from 'react';
import { formatAmount } from '@/lib/format';
import type { Txn } from '@/lib/txns';

// Passbook (design system Passbook): the student's 存折, its pages in a dark blue cover; `spread` lays two pages side by
// side on a computer, with the binding between them.
export function Passbook({ spread, children }: { spread?: boolean; children: ReactNode }) {
  return <div className={`dc-passbook ${spread ? 'is-spread' : ''}`}>{children}</div>;
}

// One page: the printed heading (with an optional link or note on the right), the page, and the printed foot.
export function PassbookPage({ title, side, foot, children, ...rest }: {
  title: string; side?: ReactNode; foot?: ReactNode; children: ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className="dc-pb-page" aria-label={title} {...rest}>
      <h2 className="dc-pb-head">{title}{side}</h2>
      {children}
      {foot && <div className="dc-pb-foot">{foot}</div>}
    </section>
  );
}

const STAR = Array.from({ length: 10 }, (_, i) => {
  const r = i % 2 ? 6.5 : 16, a = (Math.PI / 5) * i - Math.PI / 2;
  return `${(50 + r * Math.cos(a)).toFixed(1)},${(49 + r * Math.sin(a)).toFixed(1)}`;
}).join(' ');
const RIM = [...'海豚银行'];

// The bank's round red seal as a stamp leaves it: a thick rim, the bank's name round the top with each character's head
// to the rim, a large star, 业务专用章 across the bottom, and the ink a little uneven.
export function PassbookSeal() {
  const ink = useId();
  return (
    <svg className="dc-pb-seal" viewBox="0 0 100 100" aria-hidden="true">
      <filter id={ink}>
        <feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="3" seed="7" />
        <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.6 2.2" />
        <feComposite in="SourceGraphic" operator="in" />
      </filter>
      <g fill="currentColor" filter={`url(#${ink})`}>
        <circle cx="50" cy="50" r="45.5" fill="none" stroke="currentColor" strokeWidth="4" />
        {RIM.map((c, i) => (
          <text key={c} x="50" y="20.5" fontSize="15" fontWeight="800" textAnchor="middle"
            transform={`rotate(${(i - (RIM.length - 1) / 2) * 40} 50 50)`}>{c}</text>
        ))}
        <polygon points={STAR} />
        <text x="50" y="80" fontSize="9.5" fontWeight="700" textAnchor="middle" letterSpacing=".5">业务专用章</text>
      </g>
    </svg>
  );
}

// "11月3日" as a passbook prints it, "11-03", on one line; below it the time, or for an earlier year the year.
const printed = (day: string) => {
  const found = day.match(/(?:(\d{4})年)?(\d+)月(\d+)日/);
  if (!found) return { date: day, year: undefined };
  const [, y, m, d] = found;
  return { date: `${m.padStart(2, '0')}-${d.padStart(2, '0')}`, year: y && `${y}年` };
};

// The printed lines, newest first, each with its line number: date and time, 摘要, 支取 or 存入 unsigned in its own
// column, and the balance after it; a cash business leaves both columns empty and says so under 摘要. `lines` prints
// ruled empty lines up to that many, as on a page not yet filled, and `start` lines come before this page's; the first
// `fresh` lines are printed as you watch, the oldest of them first, as the counter's printer brings a 存折 up to date.
export function PassbookRows({ items, lines = 0, start = 0, fresh = 0 }: { items: Txn[]; lines?: number; start?: number; fresh?: number }) {
  const blank = Math.max(0, lines - items.length);
  return (
    <table className="dc-pb-table">
      <colgroup><col className="is-line" /><col className="is-date" /><col /><col className="is-num" /><col className="is-num" /><col className="is-num" /></colgroup>
      <thead><tr><th scope="col" className="is-line">行</th><th scope="col">日期</th><th scope="col">摘要</th>
        <th scope="col">支取</th><th scope="col">存入</th><th scope="col">余额</th></tr></thead>
      <tbody>
        {items.map((t, i) => {
          const [d, time] = t.time.split(' ');
          const { date, year } = printed(d);
          const cash = t.amount ? '' : `${t.note} · ${formatAmount(t.paid)} HTB`;
          return (
            <tr key={t.key} className={`dc-txn ${i < fresh ? 'is-printing' : ''}`}
              style={i < fresh ? { '--row': fresh - 1 - i } as React.CSSProperties : undefined}>
              <td className="is-line">{start + i + 1}</td>
              <td className="is-date">{date}<small>{year || time}</small></td>
              <td className="is-text" title={[t.title, cash].filter(Boolean).join('\n')}><span className="dc-pb-clamp">{t.title}</span>{cash && <small>{cash}</small>}</td>
              <td className="is-num is-out">{t.amount < 0 ? formatAmount(-t.amount) : ''}</td>
              <td className="is-num is-in">{t.amount > 0 ? formatAmount(t.amount) : ''}</td>
              <td className="is-num">{t.after === undefined ? '' : formatAmount(t.after)}</td>
            </tr>
          );
        })}
        {Array.from({ length: blank }, (_, i) => (
          <tr key={`blank-${i}`} aria-hidden="true"><td className="is-line">{start + items.length + i + 1}</td><td /><td /><td /><td /><td /></tr>
        ))}
      </tbody>
    </table>
  );
}
