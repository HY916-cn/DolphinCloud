// 1,280 HTB; changes are signed with + and the minus sign − (U+2212), per the design system's wording rules.
export const formatAmount = (n: number) => Math.abs(n).toLocaleString('en-US');
export const formatSigned = (n: number) => `${n < 0 ? '−' : '+'}${formatAmount(n)}`;
// A sum that may be negative, unsigned when it is not: −20, 1,280 (存款 in the ranking, net of loans).
export const formatNet = (n: number) => `${n < 0 ? '−' : ''}${formatAmount(n)}`;
// A signed number's direction, none at 0: `is-in` / `is-out` on TxnList amounts (in ink); `is-up` / `is-down`
// (`trendClass`) on dc-pl, red for a rise and green for a fall, only for rate and market moves (ColorRoles 正负).
export const signClass = (n: number) => (n > 0 ? 'is-in' : n < 0 ? 'is-out' : '');
export const trendClass = (n: number) => (n > 0 ? 'is-up' : n < 0 ? 'is-down' : '');

// 利率 (design system data.md 利率): a weekly percentage without trailing zeros, at most 4 decimals: 2.08%, 2%, 6.2667%.
export const formatRate = (r: number) => `${Number(r.toFixed(4))}%`;
// 待入账利息 from 0.01 HTB, always with two decimals: 37 → 0.37, 0 → 0.00.
export const formatCenti = (c: number) => `${c < 0 ? '−' : ''}${formatAmount(Math.trunc(c / 100))}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
// A day's 活期 interest or a correction, always signed: +1.26, −0.05, +0.00.
export const formatSignedCenti = (c: number) => `${c < 0 ? '' : '+'}${formatCenti(c)}`;
// A change of the anchor in percentage points, two decimals: +0.25, −0.50, 0.00.
export const formatPoints = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}`;
// 存贷比 40.0%, 增速 +2.3% (`signed`), one decimal.
export const formatPercent = (n: number, signed = false) => `${n < 0 ? '−' : signed && n > 0 ? '+' : ''}${Math.abs(n).toFixed(1)}%`;

// A moment as the school's clock reads it (Asia/Shanghai): year, month, day, hour and minute, hour and minute two digits.
const SHANGHAI = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
export const shanghai = (d: Date) => Object.fromEntries(SHANGHAI.formatToParts(d).map((p) => [p.type, p.value]));

// 10月27日 14:20, with the year only when it is not the current one (Asia/Shanghai).
export function formatTime(iso: string, now = new Date()) {
  const t = shanghai(new Date(iso));
  const year = t.year === shanghai(now).year ? '' : `${t.year}年`;
  return `${year}${t.month}月${t.day}日 ${t.hour}:${t.minute}`;
}

// Periods ending today (Asia/Shanghai), as [from, to] YYYY-MM-DD; a week starts on Monday.
export const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export const PERIODS = [['day', '今天'], ['week', '本周'], ['month', '本月'], ['last-month', '上月']] as const;
export function periodOf(kind: (typeof PERIODS)[number][0], now: string): [string, string] {
  if (kind === 'day') return [now, now];
  if (kind === 'week') return [shiftDay(now, -((new Date(`${now}T00:00:00Z`).getUTCDay() + 6) % 7)), now];
  if (kind === 'month') return [`${now.slice(0, 8)}01`, now];
  const end = shiftDay(`${now.slice(0, 8)}01`, -1);
  return [`${end.slice(0, 8)}01`, end];
}

// 张小明 → 张*明, 李四 → 李*.
export function maskName(name: string) {
  const c = [...name];
  return c.length < 2 ? name : c.length === 2 ? `${c[0]}*` : `${c[0]}${'*'.repeat(c.length - 2)}${c[c.length - 1]}`;
}

// 考勤: 中午班 before 13:30 Asia/Shanghai, 下午班 from 13:30 (app_private.shift_of).
export const shiftAt = (at: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at) < '13:30' ? 'am' : 'pm';

// The top of a chart's scale: the value rounded up to 1, 2 or 5 times a power of ten, so its gridlines read evenly.
export function niceMax(value: number) {
  if (value <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].find((m) => m * p >= value) ?? 10) * p;
}

// 上午好 / 下午好 / 晚上好 by the school's clock (Asia/Shanghai).
export function greeting(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hourCycle: 'h23' }).format(now));
  return h < 12 ? '上午好' : h < 18 ? '下午好' : '晚上好';
}

// One 上班 (轧账): "11月13日 07:45 – 12:30", the day again when it ended on another; "11月16日 07:45 起" while open.
export function dutySpan(start: string, end: string | null, now = new Date()) {
  if (!end) return `${formatTime(start, now)} 起`;
  const [day, time] = formatTime(end, now).split(' ');
  return `${formatTime(start, now)} – ${formatTime(start, now).startsWith(`${day} `) ? time : `${day} ${time}`}`;
}

// The cash businesses of a duty reversed afterwards: "其中 2 笔已于 14:05 冲正", each different time listed, with
// its day when it was not the day the duty ended ("14:05、11月17日 09:10"); empty when there are none.
export function reversedNote(reversed: { reversed_at: string }[], end: string | null, now = new Date()) {
  if (!reversed.length) return '';
  const endDay = end ? formatTime(end, now).split(' ')[0] : '';
  const times = [...new Set(reversed.map((r) => {
    const [day, time] = formatTime(r.reversed_at, now).split(' ');
    return day === endDay ? time : `${day} ${time}`;
  }))];
  return `其中 ${reversed.length} 笔已于 ${times.join('、')} 冲正`;
}
