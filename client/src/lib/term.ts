// 本学期 as the school reads it (Asia/Shanghai): the autumn term from 9月1日, the spring term from 2月1日.
export function termStart(now = new Date()) {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' })
    .format(now).split('-').map(Number);
  return m >= 9 ? `${y}-09-01` : m >= 2 ? `${y}-02-01` : `${y - 1}-09-01`;
}
