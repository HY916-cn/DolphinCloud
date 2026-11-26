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

// What a send has left (FileTransfer 上传): the files not yet uploaded, the one under way counted, and the bytes sent of
// all of them, the one under way by its percent; percent rounds down, and a send of empty files is 100 once done.
type Sending = { size: number; status: 'ready' | 'waiting' | 'uploading' | 'done' | 'failed'; progress: number };
export function sendProgress(items: Sending[]) {
  const total = items.reduce((s, i) => s + i.size, 0);
  const sent = items.reduce((s, i) => s + (i.status === 'done' ? i.size : i.status === 'uploading' ? Math.floor((i.size * i.progress) / 100) : 0), 0);
  const left = items.filter((i) => i.status !== 'done').length;
  return { left, sent, total, percent: total ? Math.floor((sent * 100) / total) : left ? 0 : 100 };
}

// 还剩 6 天 23 小时 / 还剩 6 天 / 还剩 5 小时 20 分 / 还剩 12 分钟 until `expiresAt`, rounded down (FileTransfer 写法).
export function remaining(expiresAt: string, now: number) {
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return '已到期';
  const m = Math.floor(ms / 60_000);
  const [d, h, min] = [Math.floor(m / 1440), Math.floor((m % 1440) / 60), m % 60];
  if (d) return `还剩 ${d} 天${h ? ` ${h} 小时` : ''}`;
  if (h) return `还剩 ${h} 小时${min ? ` ${min} 分` : ''}`;
  return `还剩 ${min} 分钟`;
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

// public_rates() (PHASE-2.md §15). today is the Shanghai date. savings_enabled false: 活期 is paused and current is 0.
// Credit paused: scores holds only the 600 row. wealth: the six 理财 products in their fixed order, each with the last day
// its net value counted, that day's rate (%, null before the first) and whether that day was closed for it.
export type PublicRates = {
  today: string;
  credit_enabled: boolean;
  savings_enabled: boolean;
  current: number;
  scores: { score: number; loan: number | null }[];
  term: Record<string, number>;
  wealth: { key: string; name: string; day: string | null; rate: number | null; closed: boolean }[];
};
// One number on the board: its text, whether a % follows, and red or green for a signed one; — when there is none.
export type Cell = { text: string; pct: boolean; trend: '' | 'is-up' | 'is-down' };
const cell = (r: number | null, signed = false): Cell => {
  if (r == null) return { text: '—', pct: false, trend: '' };
  const n = Number(r.toFixed(2));
  return { text: boardRate(r, signed), pct: true, trend: !signed || n === 0 ? '' : n > 0 ? 'is-up' : 'is-down' };
};
const monthDay = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;

// What the four tiles of 利率看板 show (design system RateBoard): 活期 one rate, or 暂停计息 (`paused`, by
// savings_enabled, not by the 0); 贷款 the scores public_rates lists, one big number at 600 while 信用分 is paused (`flat`);
// 定期 by weeks; 理财 each product's rate, with a small line under its name: its day when not today, 休市, or both.
export function boardView(r: PublicRates) {
  return {
    paused: !r.savings_enabled,
    current: cell(r.current),
    flat: !r.credit_enabled,
    loans: r.scores.map((s) => ({ label: `${s.score} 分`, cell: cell(s.loan) })),
    terms: Object.entries(r.term).sort((a, b) => Number(a[0]) - Number(b[0])).map(([weeks, rate]) => ({ label: `${weeks} 周`, cell: cell(rate) })),
    wealth: r.wealth.map((w) => ({
      key: w.key, name: w.name, cell: cell(w.rate, true),
      day: [w.day && w.day !== r.today && monthDay(w.day), w.closed && '休市'].filter(Boolean).join(' · '),
    })),
  };
}
export type BoardView = ReturnType<typeof boardView>;

// 自动滚动 (RateBoard): where the board is in its loop. At the top it waits 5 s, then goes down at `speed` px/s from
// `pos`; at the bottom it waits 5 s, then goes back up (smoothly, by the browser) and waits at the top again. `max` is
// how far it can scroll; a board that fits (max ≤ 1) waits at the top; one that grew shorter goes on from its bottom.
export type Roll = { phase: 'top' | 'down' | 'bottom' | 'up'; since: number; pos: number };
export const ROLL_WAIT = 5_000;
export function roll(r: Roll, now: number, max: number, speed: number, scrollTop: number): Roll {
  if (max <= 1) return r.phase === 'top' ? r : { phase: 'top', since: now, pos: 0 };
  switch (r.phase) {
    case 'top': return now - r.since < ROLL_WAIT ? r : { phase: 'down', since: now, pos: scrollTop };
    case 'down': {
      const pos = Math.min(max, r.pos + (speed * (now - r.since)) / 1000);
      return pos >= max ? { phase: 'bottom', since: now, pos: max } : { phase: 'down', since: now, pos };
    }
    case 'bottom': return now - r.since < ROLL_WAIT ? r : { phase: 'up', since: now, pos: 0 };
    // Back at the top, or given up on after 3 s (a smooth scroll the browser cut short).
    case 'up': return scrollTop <= 0 || now - r.since > 3_000 ? { phase: 'top', since: now, pos: 0 } : r;
  }
}
