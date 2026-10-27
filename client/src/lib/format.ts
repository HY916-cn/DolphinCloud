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
