// 本学期 as the school reads it (Asia/Shanghai): the autumn term from 9月1日, the spring term from 2月1日.
export function termStart(now = new Date()) {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' })
    .format(now).split('-').map(Number);
  return m >= 9 ? `${y}-09-01` : m >= 2 ? `${y}-02-01` : `${y - 1}-09-01`;
}

export type Tide = { from: string; start: number; saved: number; spent: number; points: string };

// The balance through the term as BalanceCard's sea: a step line (the balance only moves at a business) over a
// 1000 × 112 box, its top a quarter above the highest balance. `rows` are the term's businesses, oldest first.
// An account opened this term (nothing before) starts the sea at its first business.
export function tide(balance: number, rows: { balance_delta: number; created_at: string }[], term: string, now = new Date()): Tide {
  const start = balance - rows.reduce((n, r) => n + r.balance_delta, 0);
  const from = start === 0 && rows.length ? Date.parse(rows[0].created_at) : Date.parse(`${term}T00:00:00+08:00`);
  const span = Math.max(now.getTime() - from, 1);
  const values = [start];
  for (const r of rows) values.push(values.at(-1)! + r.balance_delta);
  const top = Math.max(...values) * 1.25 || 1;
  const x = (at: string) => (Math.min(Math.max(Date.parse(at) - from, 0), span) / span * 1000).toFixed(1);
  const y = (v: number) => (112 - v / top * 112).toFixed(1);
  let points = `0,${y(start)}`;
  rows.forEach((r, i) => { points += ` ${x(r.created_at)},${y(values[i])} ${x(r.created_at)},${y(values[i + 1])}`; });
  points += ` 1000,${y(balance)} 1000,112 0,112`;
  const [mm, dd] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(from).split('-').slice(1).map(Number);
  return {
    from: `${mm}月${dd}日`,
    start,
    saved: rows.reduce((n, r) => n + Math.max(r.balance_delta, 0), 0),
    spent: rows.reduce((n, r) => n + Math.min(r.balance_delta, 0), 0),
    points,
  };
}
