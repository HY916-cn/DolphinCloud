// 本学期 as the school reads it (Asia/Shanghai): the autumn term from 9月1日, the spring term from 2月1日.
export function termStart(now = new Date()) {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' })
    .format(now).split('-').map(Number);
  return m >= 9 ? `${y}-09-01` : m >= 2 ? `${y}-02-01` : `${y - 1}-09-01`;
}

// 学期 (PHASE-2.md §6) as the 学期 page lists it; dates are YYYY-MM-DD, so they compare as strings.
export type Term = { id: string; name: string; starts_on: string; ends_on: string; closed_at: string | null };
export type TermState = 'upcoming' | 'current' | 'ended' | 'closed';
export const termState = (t: Term, today: string): TermState =>
  t.closed_at ? 'closed' : today < t.starts_on ? 'upcoming' : today <= t.ends_on ? 'current' : 'ended';

// 2027-01-20 → 1月20日.
export const monthDay = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;

const JOBS: Record<string, string> = { daily: '每天的任务', weekly: '每周的任务' };

// One line of the 还不能结转 list (TERM_OPEN_ITEMS): what is open and how it stands. A kind this version does not know
// still gets a line.
export function openItem(item: Record<string, unknown>, endsOn: string): [string, string] {
  if (item.kind === 'job') return [JOBS[String(item.job)] ?? '定时任务', `已处理到 ${monthDay(String(item.done_to))}，需处理到 ${monthDay(endsOn)}`];
  if (item.kind === 'term_deposit') return [String(item.name), `定期 ${Number(item.principal).toLocaleString('en-US')} HTB · ${monthDay(String(item.matures_on))} 到期`];
  return [String(item.name ?? '其他事项'), '处理完后再结转'];
}

// A failed scheduled job (job_runs.last_err is "2026-11-10: division by zero"): its name, the last day done, the day that
// failed and why.
export function jobFailure(row: { job: string; done_to: string; last_err: string }) {
  const m = /^(\d{4}-\d{2}-\d{2}): ([\s\S]*)$/.exec(row.last_err);
  return { job: JOBS[row.job] ?? row.job, done: monthDay(row.done_to), day: m ? monthDay(m[1]) : null, reason: m ? m[2] : row.last_err };
}
