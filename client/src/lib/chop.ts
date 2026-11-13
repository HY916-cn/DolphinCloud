// The holder's name seal on the 存折's 我的 page (design system Passbook): the name without its dots, read column by
// column from the right. Two characters take 之印 and three take 印 (two columns of two); five take 印 and six stay as
// they are (is-six, three columns of two); three columns of three are always full (is-nine): seven take 之印, eight take
// 印, and a longer name keeps its first nine.
export function nameChop(name: string) {
  const chars = Array.from(name.replace(/[\s·•・･]/g, ''));
  const n = chars.length;
  const text = chars.slice(0, 9).join('') + (n === 2 || n === 7 ? '之印' : n === 3 || n === 5 || n === 8 ? '印' : '');
  return { text, size: n > 6 ? 'is-nine' : n > 4 ? 'is-six' : '' };
}
