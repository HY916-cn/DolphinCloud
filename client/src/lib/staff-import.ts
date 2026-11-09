// The staff template (PHASE-2.md §5.1): one header row, then one login per row. Checked here first so every problem
// shows with its row number before anything is imported; import_staff checks the same rules again.
export const STAFF_HEADER = ['账号', '姓名', '身份', '工资账户'] as const;
export const STAFF_ROLES = { 柜员: 'teller', 财务: 'accountant', 库管: 'storekeeper', 行长: 'president', 运维员: 'sysadmin' } as const;
export type StaffRole = (typeof STAFF_ROLES)[keyof typeof STAFF_ROLES];
export const STAFF_LOGIN = /^[a-z0-9][a-z0-9_.-]{1,31}$/; // as 新增账号 and valid_staff_login

export type StaffRow = { login_id: string; name: string; role: StaffRole; account: string | null };
export type StaffProblem = { row: number; text: string };
// What the database holds, read just before checking.
export type StaffKnown = {
  logins: Map<string, { id: string; role: string | null; disabled: boolean; closed: boolean }>;
  students: Map<string, string>; // student number → status
  bound: Map<string, string>; // student number → the user id it is bound to
};

const text = (v: unknown) => (v == null ? '' : String(v).trim());
const title = (role: string | null) => Object.entries(STAFF_ROLES).find(([, r]) => r === role)?.[0] ?? (role === 'teacher' ? '银行管理员' : '未分配身份');

// `table` is the sheet as rows of cells (SheetJS sheet_to_json with header: 1). Empty rows are skipped.
export function checkStaff(table: unknown[][], known: StaffKnown): { rows: StaffRow[]; problems: StaffProblem[] } {
  const head = (table[0] ?? []).map(text);
  const missing = STAFF_HEADER.filter((h) => !head.includes(h));
  if (missing.length) return { rows: [], problems: [{ row: 1, text: `表头缺少「${missing.join('」「')}」，请使用导入模板。` }] };
  const col = Object.fromEntries(STAFF_HEADER.map((h) => [h, head.indexOf(h)])) as Record<(typeof STAFF_HEADER)[number], number>;

  const rows: StaffRow[] = [];
  const problems: StaffProblem[] = [];
  const logins = new Map<string, number>();
  const accounts = new Map<string, number>();
  table.slice(1).forEach((cells, i) => {
    const row = i + 2;
    const get = (h: (typeof STAFF_HEADER)[number]) => text(cells[col[h]]);
    if (STAFF_HEADER.every((h) => !get(h))) return;
    const say = (t: string) => problems.push({ row, text: t });
    const login = get('账号').toLowerCase();
    const name = get('姓名');
    const roleText = get('身份');
    const role = (STAFF_ROLES as Record<string, StaffRole>)[roleText];
    const account = get('工资账户');
    const existing = known.logins.get(login);
    const before = problems.length;

    if (!STAFF_LOGIN.test(login)) say(login ? `账号「${login}」不符合格式：2–32 位小写字母、数字、. _ -，以字母或数字开头。` : '缺少账号。');
    else if (logins.has(login)) say(`账号 ${login} 与第 ${logins.get(login)} 行重复。`);
    else if (existing?.closed) say(`账号 ${login} 已注销，不能再使用，请换一个账号。`);
    else if (existing?.disabled) say(`账号 ${login} 已停用，请先启用，或换一个账号。`);
    else if (existing && role && existing.role !== role) say(`账号 ${login} 现在是${title(existing.role)}，与表里的「${roleText}」不同；要改身份请到工作人员详情里修改。`);
    if (!name) say('缺少姓名。');
    if (roleText === '银行管理员') say('银行管理员不能导入。');
    else if (!role) say(`身份请填写${Object.keys(STAFF_ROLES).join('、')}之一。`);

    if (account) {
      const status = known.students.get(account);
      if (role && role !== 'teller') say('只有柜员可以绑定工资账户，其他身份请留空。');
      else if (accounts.has(account)) say(`工资账户 ${account} 与第 ${accounts.get(account)} 行重复。`);
      else if (status === undefined) say(`工资账户：学号 ${account} 不存在。`);
      else if (status !== 'normal') say(`工资账户：学号 ${account} 不是在读账户。`);
      else if (known.bound.has(account) && known.bound.get(account) !== existing?.id) say(`工资账户 ${account} 已绑定其他工作人员。`);
    }

    if (login) logins.set(login, logins.get(login) ?? row);
    if (account) accounts.set(account, accounts.get(account) ?? row);
    if (problems.length === before) rows.push({ login_id: login, name, role, account: account || null });
  });
  return { rows, problems };
}
