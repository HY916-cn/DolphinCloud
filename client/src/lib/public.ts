// The three pages that need no sign-in (PHASE-2.md §16.4): 利率看板, 大屏时间 and 文件传输. Loads on its own, as the
// unit tests load it.

// 820 KB, 12.4 MB, 1.2 GB: steps of 1024, one decimal without a trailing .0; under 1 KB reads 1 KB (FileTransfer 写法).
export function formatSize(bytes: number) {
  let n = bytes / 1024;
  if (n < 1) return '1 KB';
  for (const unit of ['KB', 'MB', 'GB']) {
    const shown = Math.round(n * 10) / 10;
    if (shown < 1024 || unit === 'GB') return `${shown} ${unit}`;
    n /= 1024;
  }
  return '';
}

// A rate on the board: 2 decimals without trailing zeros (2.1333 → 2.13, 4.50 → 4.5, 3 → 3); `signed` adds + or −
// (理财), 0 without a sign (RateBoard 写法).
export function boardRate(r: number, signed = false) {
  const n = Number(r.toFixed(2));
  return `${n < 0 ? '−' : signed && n > 0 ? '+' : ''}${Math.abs(n)}`;
}

// The limits of one send (PHASE-2.md §16.4), in bytes: 1 MB = 1048576.
export const MAX_FILES = 20;
export const MAX_FILE = 104_857_600;
export const MAX_TOTAL = 209_715_200;

type Picked = { name: string; size: number };
// What the files picked break, as create_transfer's FILE_TOO_LARGE details: too many, each one too big, too much in all;
// null when they can be sent. Several may hold; the page shows the first.
export function tooLarge(files: Picked[]) {
  const total = files.reduce((s, f) => s + f.size, 0);
  const big = files.filter((f) => f.size > MAX_FILE);
  if (files.length > MAX_FILES) return { field: 'count', max: MAX_FILES, count: files.length };
  if (big.length) return { field: 'file', max: MAX_FILE, files: big.map((f) => ({ name: f.name, size: f.size })) };
  if (total > MAX_TOTAL) return { field: 'total', max: MAX_TOTAL, total };
  return null;
}

// The 4 digits of a pickup code typed or pasted: digits only, at most 4.
export const codeDigits = (text: string) => text.replace(/\D/g, '').slice(0, 4);

// 授时 (BigClock): of the calls to server_time(), the one with the shortest round trip; its offset is the server's time
// plus half the round trip less the local time when the answer came, in milliseconds.
export type Sample = { sent: number; received: number; server: number };
export function clockOffset(samples: Sample[]) {
  if (!samples.length) return null;
  const best = samples.reduce((a, b) => (b.received - b.sent < a.received - a.sent ? b : a));
  return best.server + (best.received - best.sent) / 2 - best.received;
}

// 14:30:05 and 11月20日 星期四 on the school's clock (Asia/Shanghai).
const CLOCK = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
export function clockFace(ms: number) {
  const t = Object.fromEntries(CLOCK.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { time: `${t.hour}:${t.minute}:${t.second}`, date: `${t.month}月${t.day}日 ${t.weekday}` };
}

// public_rates() (PHASE-2.md §15). wealth.day, change and each tier's rate are null before the first quote; on a closed
// day day is today, change 0 and the rates are the bases. Credit paused: scores holds only the 600 row.
export type PublicRates = {
  credit_enabled: boolean;
  current: number;
  scores: { score: number; loan: number | null }[];
  term: Record<string, number>;
  wealth: {
    name: string; weeks: number; day: string | null; change: number | null; closed: boolean;
    tiers: { key: string; name: string; multiplier: number; rate: number | null }[];
  };
};
// One number on the board: its text, whether a % follows, and red or green for a signed one; — when there is none.
export type Cell = { text: string; pct: boolean; trend: '' | 'is-up' | 'is-down' };
const cell = (r: number | null, signed = false): Cell => {
  if (r == null) return { text: '—', pct: false, trend: '' };
  const n = Number(r.toFixed(2));
  return { text: boardRate(r, signed), pct: true, trend: !signed || n === 0 ? '' : n > 0 ? 'is-up' : 'is-down' };
};

// What the five tiles of 利率看板 show (design system RateBoard): 活期 one rate; 贷款 the scores public_rates lists (a
// paused credit score leaves one); 定期 by weeks; 指数 one row, 休市 on a closed day; 理财 each tier.
export function boardView(r: PublicRates) {
  return {
    current: cell(r.current),
    loans: r.scores.map((s) => ({ label: `${s.score} 分`, cell: cell(s.loan) })),
    terms: Object.entries(r.term).sort((a, b) => Number(a[0]) - Number(b[0])).map(([w, rate]) => ({ label: `${w} 周`, cell: cell(rate) })),
    index: { label: r.wealth.name, cell: r.wealth.closed ? { text: '休市', pct: false, trend: '' } as Cell : cell(r.wealth.change, true) },
    tiers: r.wealth.tiers.map((t) => ({ key: t.key, name: t.name, multiplier: t.multiplier, cell: cell(t.rate, true) })),
  };
}
export type BoardView = ReturnType<typeof boardView>;
