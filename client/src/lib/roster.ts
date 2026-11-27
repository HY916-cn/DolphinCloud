// The roster template (PHASE-1.md §6.5): one header row, then one student per row. Checked here first so the teacher
// sees every problem with its row number before anything is imported; import_roster checks the same rules again.
export const HEADER = ['学号', '姓名', '学部', '学届', '班号', '期初余额'] as const;
const DIVISIONS: Record<string, 'primary' | 'junior'> = { 小学部: 'primary', 初中部: 'junior' };
const GRADES = { primary: [1, 6, '一至六年级'], junior: [7, 9, '七至九年级'] } as const;

export type RosterRow = {
  student_no: string; name: string; division: 'primary' | 'junior'; cohort: number; class_no: number; opening_balance: number | null;
};
export type RosterProblem = { row: number; text: string };

// Grade in the school year that contains `on` (Asia/Shanghai); each year starts on `promotion` (MM-DD), as grade_of.
export function gradeOf(division: 'primary' | 'junior', cohort: number, promotion: string, on = new Date()) {
  const [y, md] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(on).split(/-(.*)/);
  return Number(y) - (md < promotion ? 1 : 0) - cohort + (division === 'junior' ? 7 : 1);
}

const text = (v: unknown) => (v == null ? '' : String(v).trim());
const int = (v: string) => (/^\d+$/.test(v) ? Number(v) : NaN);

// `table` is the sheet as rows of cells (SheetJS sheet_to_json with header: 1 and cellDates), `shown` the same cells as
// the sheet shows them (raw: false); 学号 is read as shown (design system data.md 名册导入). A 学号 cell Excel holds as a
// date, or as a number shown otherwise than its digits (a number format), is a problem: Excel may have changed it. Empty
// rows are skipped. `hints` (a 纯数字 学号 shorter than all the others: a lost leading 0, perhaps) do not stop the import.
export function checkRoster(table: unknown[][], promotion: string, on = new Date(), shown: unknown[][] = table):
  { rows: RosterRow[]; problems: RosterProblem[]; hints: RosterProblem[] } {
  const head = (table[0] ?? []).map(text);
  const missing = HEADER.filter((h) => !head.includes(h));
  if (missing.length) return { rows: [], problems: [{ row: 1, text: `表头缺少「${missing.join('」「')}」，请使用导入模板。` }], hints: [] };
  const col = Object.fromEntries(HEADER.map((h) => [h, head.indexOf(h)])) as Record<(typeof HEADER)[number], number>;

  const rows: RosterRow[] = [];
  const problems: RosterProblem[] = [];
  const seen = new Map<string, number>();
  table.slice(1).forEach((cells, i) => {
    const row = i + 2;
    const get = (h: (typeof HEADER)[number]) => text(cells[col[h]]);
    if (HEADER.every((h) => !get(h))) return;
    const say = (t: string) => problems.push({ row, text: t });
    const cell = cells[col['学号']];
    const no = text(shown[i + 1]?.[col['学号']] ?? cell);
    const typed = cell instanceof Date || typeof cell === 'number' && no !== String(cell);
    const name = get('姓名');
    const division = DIVISIONS[get('学部')];
    const cohort = int(get('学届'));
    const classNo = int(get('班号'));
    const opening = get('期初余额') === '' ? null : int(get('期初余额'));
    const before = problems.length;

    if (typed) say('学号单元格是数字或日期格式，可能已被 Excel 改过。请把学号列设为文本，重新填写后再导出。');
    else if (!/^[A-Za-z0-9_-]{1,32}$/.test(no)) say(no ? `学号「${no}」只能包含字母、数字、- 和 _。` : '缺少学号。');
    else if (seen.has(no)) say(`学号 ${no} 与第 ${seen.get(no)} 行重复。`);
    if (!name) say('缺少姓名。');
    if (!division) say('学部请填写「小学部」或「初中部」。');
    if (!(cohort >= 2000 && cohort <= 2100)) say('学届请填写入学年份，如 2023。');
    else if (division) {
      const [lo, hi, label] = GRADES[division];
      const g = gradeOf(division, cohort, promotion, on);
      if (g < lo || g > hi) say(`${cohort} 届现在不在${get('学部')}的年级内（${label}）。`);
    }
    if (!(classNo >= 1 && classNo <= 99)) say('班号请填写 1–99 的整数。');
    if (opening !== null && !(opening <= 1_000_000)) say('期初余额请填写不小于 0 的整数，或留空。');

    if (no) seen.set(no, seen.get(no) ?? row);
    if (problems.length === before) {
      rows.push({ student_no: no, name, division: division!, cohort, class_no: classNo, opening_balance: opening });
    }
  });
  const hints: RosterProblem[] = [];
  const all = [...seen.keys()];
  for (const [no, row] of seen) {
    if (/^\d+$/.test(no) && all.length > 1 && all.every((x) => x === no || x.length > no.length)) {
      hints.push({ row, text: `学号 ${no} 比其他学号短，可能丢了前面的 0。` });
    }
  }
  return { rows, problems, hints };
}
