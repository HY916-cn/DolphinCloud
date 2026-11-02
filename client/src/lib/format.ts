// 1,280 HTB; changes are signed with + and the minus sign − (U+2212), per the design system's wording rules.
export const formatAmount = (n: number) => Math.abs(n).toLocaleString('en-US');
export const formatSigned = (n: number) => `${n < 0 ? '−' : '+'}${formatAmount(n)}`;

// 10月27日 14:20, with the year only when it is not the current one (Asia/Shanghai).
export function formatTime(iso: string, now = new Date()) {
  const part = (d: Date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(d).map((p) => [p.type, p.value]),
    );
  const t = part(new Date(iso));
  const year = t.year === part(now).year ? '' : `${t.year}年`;
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

// 考勤: 上午班 before 13:30 Asia/Shanghai, 下午班 from 13:30 (app_private.shift_of).
export const shiftAt = (at: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at) < '13:30' ? 'am' : 'pm';
