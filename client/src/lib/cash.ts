// Cash at the counter: notes counted per face value ({"10": 2, "5": 1}), the payout for a withdrawal and the change
// for a cash purchase. Faces come from settings.denominations; greedy from the largest face is the fewest notes
// for 1/2/5/10 (PHASE-1.md §7.5), and the server computes change the same way (app_private.make_change).
export type Counts = Record<string, number>;

export const cashTotal = (counts: Counts) => Object.entries(counts).reduce((sum, [face, n]) => sum + Number(face) * n, 0);

export function makeChange(amount: number, faces: number[]): Counts {
  const counts: Counts = {};
  let left = amount;
  for (const face of [...faces].sort((a, b) => b - a)) {
    if (left >= face) {
      counts[face] = Math.floor(left / face);
      left %= face;
    }
  }
  return counts;
}

// "10 元 × 2 张、5 元 × 1 张", largest face first, empty faces left out.
export const describeCash = (counts: Counts) =>
  Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([face, n]) => `${face} 元 × ${n} 张`)
    .join('、');

// Only the faces with notes, as the RPCs take them.
export const nonEmpty = (counts: Counts): Counts => Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));

// A number in the 下班总结 cash table: notes short as "少 N 张", an amount short with −; `short` draws it in danger.
export const cashCell = (n: number, notes: boolean) => ({
  text: n >= 0 ? n.toLocaleString('en-US') : notes ? `少 ${-n} 张` : `−${(-n).toLocaleString('en-US')}`,
  short: n < 0,
});

// 轧账 (PHASE-2.md §7.1): the notes counted in the box against what it should hold, per face: counted − expected,
// for every face the box should hold. The server works it out the same way and its answer (NOTE_REQUIRED.diff) wins.
export const compareCash = (expected: Counts, counted: Counts): Counts =>
  Object.fromEntries(Object.entries(expected).map(([face, n]) => [face, (counted[face] ?? 0) - n]));
export const isBalanced = (diff: Counts) => Object.values(diff).every((n) => n === 0);

// One face on its card: 相符, 多 2 张, 少 1 张.
export const diffNotes = (n: number) => (n === 0 ? '相符' : n > 0 ? `多 ${n} 张` : `少 ${-n} 张`);

// The whole box: 平, 多 5 HTB, 少 3 HTB, or 面额不对 when the amounts agree but the faces do not.
export function diffAmount(diff: Counts) {
  const total = cashTotal(diff);
  return isBalanced(diff) ? '平' : total > 0 ? `多 ${total.toLocaleString('en-US')} HTB`
    : total < 0 ? `少 ${(-total).toLocaleString('en-US')} HTB` : '面额不对';
}

// The faces that differ, largest first: "5 元少 1 张，2 元多 1 张".
export const diffFaces = (diff: Counts) =>
  Object.entries(diff).filter(([, n]) => n !== 0).sort(([a], [b]) => Number(b) - Number(a))
    .map(([face, n]) => `${face} 元${diffNotes(n)}`).join('，');

// The notes of one cash business, largest face first: "收 10 元 × 2、5 元 × 1"; an exchange gives change
// ("收 10 元 × 2，找 2 元 × 1"), anything else pays out ("付 10 元 × 3").
export function cashNotes(income: Counts | null, payout: Counts | null, type: string) {
  const list = (c: Counts) => Object.entries(c).filter(([, n]) => n > 0).sort(([a], [b]) => Number(b) - Number(a))
    .map(([face, n]) => `${face} 元 × ${n}`).join('、');
  return [income && list(income) && `收 ${list(income)}`, payout && list(payout) && `${type === 'purchase' ? '找' : '付'} ${list(payout)}`]
    .filter(Boolean).join('，');
}

// The 轧账 page, or one duty's 复核 page, with the list's filters (tab, user, day) kept in the address.
export function cashHref(params: Record<string, string | undefined>, duty?: string) {
  const query = new URLSearchParams(Object.entries(params).filter((p): p is [string, string] => !!p[1])).toString();
  return `/admin/cash${duty ? `/${duty}` : ''}${query ? `?${query}` : ''}`;
}
