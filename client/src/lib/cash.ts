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
