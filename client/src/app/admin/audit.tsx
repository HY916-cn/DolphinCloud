import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Desk, FilterBar, filtered, Icon, link, NO_FILTER, Notice, sectionsFor, TxnListLoading, type Chip, type Filter, type Suggestion } from '@/components';
import { describeCash, type Counts } from '@/lib/cash';
import { formatTime } from '@/lib/format';
import { findScopes } from '@/lib/search';
import { useMe } from '@/lib/session';
import { useStudents } from '@/lib/students';
import { supabase } from '@/lib/supabase';

const PAGE = 50;
type Entry = {
  id: number; at: string; actor_id: string | null; action: string; target: string | null;
  before: unknown; after: unknown; ip: string | null; device_id: string | null;
};
type Row = Record<string, unknown>;
// Names of the actors and of the logins entries are about; `staff` holds the staff logins among them.
type People = { names: Map<string, string>; staff: Set<string> };

// Function logs (PHASE-1.md §5.5) and the trigger rows "<table>.<insert|update|delete>" (app_private.audit_row).
const ACTIONS: Record<string, string> = {
  'roster.import': '名册导入', 'user.reset_password': '重置密码', 'txn.reverse': '冲正', 'check.mismatch': '余额自检不一致',
  'login.ok': '登录成功', 'login.failed': '密码错误', 'login.locked': '登录被锁定', 'user.reissue_passwords': '重新生成初始密码',
  'backup.create': '创建备份', 'backup.restore': '恢复备份', 'salary.pay': '发放工资', 'payroll.wrong_password': '绑定工资账户密码错误',
  'user.close': '注销账号', 'salary.bind': '绑定工资账户', 'staff.import': '工作人员导入',
};
const TABLES: Record<string, string> = {
  students: '学生', profiles: '账号', user_roles: '身份', products: '商品', currency_issues: '发行', settings: '参数',
  attendance: '考勤', staff_payroll: '考勤设置', duty: '上下班',
};
const OPS: Record<string, string> = { insert: '新增', update: '修改', delete: '删除' };
// The type chips: each a group of actions, by prefix.
const GROUPS: Record<string, [string, string[]]> = {
  account: ['账号与登录', ['profiles.', 'user_roles.', 'user.', 'login.']],
  student: ['学生', ['students.', 'roster.']],
  reverse: ['冲正', ['txn.']],
  product: ['商品', ['products.']],
  settings: ['参数', ['settings.']],
  attendance: ['考勤与工资', ['attendance.', 'staff_payroll.', 'duty.', 'salary.', 'payroll.']],
  system: ['备份与自检', ['backup.', 'check.']],
};
const KINDS = Object.entries(GROUPS).map(([k, [name]]) => [k, name] as const);
// What the search picked: whose entries (an actor, or a student: their own and about them) and which action.
type AuditFilter = Filter & { actor: string; student: { no: string; id: string | null; name: string } | null; action: string };
const SETTINGS: Record<string, string> = {
  denominations: '面额', withdraw_single_limit: '单笔取款上限', withdraw_daily_limit: '单日取款上限',
  ranking_anonymous: '排名匿名', ranking_size: '排名人数', promotion_date: '升年级日期', salary_per_shift: '班次工资',
};
const COLUMNS: Record<string, string> = {
  name: '名称', display_name: '姓名', login_id: '账号', disabled: '停用', must_change_password: '需要修改密码', role: '身份',
  student_no: '学号', division: '学部', cohort: '学届', class_no: '班号', class_label: '班级名称', status: '状态',
  price: '价格', cost: '成本', category: '分类', listed: '上架', stock: '库存', safety_stock: '安全库存', image_path: '图片',
  batch_no: '批次号', issued_on: '发行日期', denominations: '面额', total: '总额', purpose: '用途', approver_name: '审批人',
  value: '取值', type: '类型', amount: '金额', balance_delta: '余额变动', balance_after: '办理后余额', reason: '原因',
  txn_no: '交易号', created: '新开账户', updated: '更新学生',
  failures: '15 分钟内密码错误次数', locked_until: '锁定到', valid: '密码正确', student_nos: '学号', file: '备份文件',
  attendance: '参与考勤', account: '工资账户', day: '日期', shift: '班次', note: '说明', signed_at: '记录时间',
  started_at: '上班时间', ended_at: '下班时间', txns: '业务笔数', closed_at: '注销时间',
  from: '起', to: '止', rates: '班次工资', paid: '发放',
};
// Columns that change on every write and say nothing to the reader.
const NOISE = new Set(['id', 'seq', 'created_at', 'updated_at', 'updated_by', 'created_by', 'opened_at', 'user_id', 'operator_id', 'device_id',
  'signed_by', 'reviewed_by', 'reviewed_at', 'salary_txn', 'pay']);
const WORDS: Record<string, string> = {
  primary: '小学部', junior: '初中部', normal: '正常', frozen: '冻结', graduated: '毕业', reversed: '已冲正',
  teller: '柜员', accountant: '财务', storekeeper: '库管', president: '行长', teacher: '银行管理员', sysadmin: '运维员',
  am: '中午班', pm: '下午班', pending: '待审', confirmed: '有效', rejected: '未通过',
};

const asRow = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});

function label(e: Entry) {
  const [table, op] = e.action.split('.');
  return ACTIONS[e.action] ?? (TABLES[table] && OPS[op] ? `${OPS[op]}${TABLES[table]}` : e.action);
}

// The login an entry is about: profiles:<id>, or user_roles:<user_id> for a change of role.
const profileOf = (e: Entry) => e.target?.match(/^(?:profiles|user_roles):(.+)$/)?.[1] ?? null;

// The page of the entry's object, when there is one: the staff login, the student, the product, or for a reversal
// the student's 流水.
type Target = { href: string; label: string } | null;
function targetOf(e: Entry, staff: Set<string>): Target {
  const id = profileOf(e);
  if (id) return staff.has(id) ? { href: `/admin/staff/${id}`, label: '查看账号' } : null;
  if (e.target?.startsWith('students:')) return { href: `/admin/students/${e.target.slice(9)}`, label: '查看学生' };
  if (e.target?.startsWith('products:')) return { href: `/admin/products/${e.target.slice(9)}`, label: '查看商品' };
  const no = e.action === 'txn.reverse' ? asRow(e.before).student_no : null;
  return no ? { href: `/admin/txns?student=${no}`, label: '查看学生流水' } : null;
}

// What the entry is about, in the row's own words: the batch, student, product, login or setting; for a reversal the
// original transaction, for a password reset or a sign-in the login, for a backup its file.
function subject(e: Entry, names: Map<string, string>) {
  const r = e.action === 'txn.reverse' ? asRow(e.before) : { ...asRow(e.before), ...asRow(e.after) };
  if (e.action === 'user.reset_password' || e.action.startsWith('login.')) return names.get(profileOf(e) ?? '') ?? '';
  if (e.action === 'user.reissue_passwords') return `${Array.isArray(r.student_nos) ? r.student_nos.length : 0} 名学生`;
  if (e.action.startsWith('backup.')) return String(r.file ?? '');
  if (e.action.startsWith('settings.')) return SETTINGS[String(r.key)] ?? String(r.key ?? '');
  if (e.action === 'check.mismatch') return `${Array.isArray(e.after) ? e.after.length : 0} 处不一致`;
  if (e.action === 'salary.pay') return `${r.from} 至 ${r.to}`;
  if (e.action === 'salary.bind') return [names.get(profileOf(e) ?? ''), r.name, r.student_no].filter(Boolean).join(' · ');
  if (e.action.startsWith('attendance.') || e.action.startsWith('staff_payroll.'))
    return [names.get(String(r.user_id)), r.day, r.shift && WORDS[String(r.shift)]].filter(Boolean).join(' · ');
  return [...new Set([r.batch_no, r.txn_no, r.name ?? r.display_name, r.student_no ?? r.login_id])].filter((v) => v != null && v !== '').join(' · ');
}

function show(v: unknown): string {
  if (v == null || v === '') return '空';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (Array.isArray(v)) return v.map(show).join(', ');
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${WORDS[k] ?? k} ${show(x)}`).join('、');
  return WORDS[String(v)] ?? String(v);
}

// The fields whose value differs between before and after.
function changes(e: Entry): [string, string][] {
  const before = asRow(e.before);
  const after = asRow(e.after);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => !NOISE.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => {
      // Notes counted per face ({"10": 2}) read as "10 元 × 2 张"; other values as they are.
      const v = (x: unknown) => (k === 'denominations' && x && typeof x === 'object' && !Array.isArray(x) ? describeCash(x as Counts) : show(x));
      return [COLUMNS[k] ?? k, k in before && k in after ? `${v(before[k])} → ${v(after[k])}` : v(after[k] ?? before[k])];
    });
}

// 日志 (teacher, sysadmin): the audit log, newest first, 50 at a time; a row opens to show what changed and links to
// its object. The filter bar finds a login (staff, or a student: their own entries and those about them) or an
// action, then the days and the types. ?actor=<profile id> starts with one login's entries.
export default function Audit() {
  const { actor } = useLocalSearchParams<{ actor?: string }>();
  return <AuditLog key={actor ?? ''} actor={actor ?? ''} />;
}

function AuditLog({ actor: initial }: { actor: string }) {
  const me = useMe().data!;
  const students = useStudents();
  const [f, setF] = useState<AuditFilter>({ ...NO_FILTER, actor: initial, student: null, action: '' });
  const set = (patch: Partial<AuditFilter>) => setF((x) => ({ ...x, ...patch }));
  // Only links to pages this login may open.
  const allowed = (href: string) => sectionsFor(me).some((s) => href.startsWith(s.href));
  // Staff logins for the search, stopped and closed ones too: the log is their record.
  const staff = useQuery({
    queryKey: ['audit-staff'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id,display_name').eq('login_kind', 'staff').order('display_name');
      if (error) throw error;
      return data as { id: string; display_name: string }[];
    },
  });
  const actorName = f.actor ? staff.data?.find((p) => p.id === f.actor)?.display_name ?? '…' : '';

  function suggest(text: string): Suggestion[] {
    const q = text.toLowerCase();
    const actions = [...Object.entries(ACTIONS), ...Object.entries(TABLES).flatMap(([t, n]) => Object.entries(OPS).map(([o, w]) => [`${t}.${o}`, `${w}${n}`]))];
    return [
      ...(staff.data ?? []).filter((p) => p.display_name.toLowerCase().includes(q)).slice(0, 4)
        .map((p) => ({ key: `p-${p.id}`, icon: 'teacher' as const, label: p.display_name, note: '工作人员', pick: () => set({ actor: p.id, student: null }) })),
      ...findScopes(students.data?.index ?? [], text, 6).filter((s) => s.kind === 'student').map((s) => {
        const row = s.kind === 'student' ? students.data?.rows.find((r) => r.student_no === s.student_no) : undefined;
        return { key: `s-${s.label}`, icon: 'me' as const, label: s.label, note: s.note,
          pick: () => set({ actor: '', student: { no: row?.student_no ?? '', id: row?.user_id ?? null, name: row?.name ?? s.label } }) };
      }),
      ...actions.filter(([, n]) => n.includes(text)).slice(0, 4)
        .map(([a, n]) => ({ key: `a-${a}`, icon: 'inbox' as const, label: `操作：${n}`, pick: () => set({ action: a }) })),
    ];
  }
  const chips: Chip[] = [
    ...(f.actor ? [{ key: 'actor', label: `操作人 ${actorName}`, clear: () => set({ actor: '' }) }] : []),
    ...(f.student ? [{ key: 'student', label: `${f.student.name} · 学号 ${f.student.no}`, clear: () => set({ student: null }) }] : []),
    ...(f.action ? [{ key: 'action', label: `操作 ${ACTIONS[f.action] ?? label({ action: f.action } as Entry)}`, clear: () => set({ action: '' }) }] : []),
  ];
  const narrowed = chips.length > 0 || filtered(f);

  const list = useInfiniteQuery({
    queryKey: ['audit-log', f],
    initialPageParam: 0,
    getNextPageParam: (last: { entries: Entry[] } & People, pages) => (last.entries.length === PAGE ? pages.length : undefined),
    queryFn: async ({ pageParam }) => {
      let q = supabase.from('audit_log').select('id,at,actor_id,action,target,before,after,ip,device_id');
      if (f.actor) q = q.eq('actor_id', f.actor);
      if (f.student) q = q.or([`target.eq."students:${f.student.no}"`, ...(f.student.id ? [`actor_id.eq.${f.student.id}`, `target.eq."profiles:${f.student.id}"`] : [])].join(','));
      if (f.action) q = q.eq('action', f.action);
      if (f.kinds.length) q = q.or(f.kinds.flatMap((k) => GROUPS[k][1]).map((p) => `action.like."${p}*"`).join(','));
      if (f.from) q = q.gte('at', `${f.from}T00:00:00+08:00`);
      if (f.to) q = q.lt('at', `${f.to}T24:00:00+08:00`);
      const { data, error } = await q.order('id', { ascending: false }).range(pageParam * PAGE, pageParam * PAGE + PAGE - 1);
      if (error) throw error;
      const entries = data as Entry[];
      const ids = [...new Set(entries.flatMap((e) => [e.actor_id, profileOf(e)].filter((id): id is string => !!id)))];
      const names = new Map<string, string>();
      const staff = new Set<string>();
      if (ids.length) {
        const { data: people, error: e } = await supabase.from('profiles').select('id,display_name,login_kind').in('id', ids);
        if (e) throw e;
        for (const p of people) {
          names.set(p.id, p.display_name);
          if (p.login_kind === 'staff') staff.add(p.id);
        }
      }
      return { entries, names, staff };
    },
  });
  const pages = list.data?.pages;

  return (
    <Desk title="日志">
      <FilterBar label="筛选日志" placeholder="搜索操作人、学生或操作" value={f} onChange={(v) => setF((x) => ({ ...x, ...v }))}
        kinds={KINDS} suggest={suggest} chips={chips} times={false} />
      <section className="dc-stack dc-enter" aria-label="操作日志">
        {list.error && !pages ? (
          <Notice tone="danger" title="暂时无法读取日志">请检查网络后刷新页面。</Notice>
        ) : !pages ? (
          <TxnListLoading />
        ) : pages[0].entries.length ? (
          <>
            <ul className="dc-txns">
              {pages.flatMap((p) => p.entries.map((e) => ({ e, p }))).map(({ e, p }, i) => {
                const to = targetOf(e, p.staff);
                return <AuditLine key={e.id} first={!i} entry={e} names={p.names} to={to && allowed(to.href) ? to : null} />;
              })}
            </ul>
            {list.isFetchingNextPage && <TxnListLoading rows={2} />}
          </>
        ) : (
          <div className="dc-card">
            <div className="dc-empty">
              <span className="dc-empty-icon"><Icon name="inbox" /></span>
              <h3>{narrowed ? '没有符合条件的日志' : '还没有操作日志'}</h3>
              <p>{narrowed ? '换个搜索、日期或类型试试。' : '导入名册、修改参数等操作会记录在这里。'}</p>
            </div>
          </div>
        )}
        {list.error && pages && <Notice tone="danger" title="暂时无法读取更早的日志">请检查网络后再试一次。</Notice>}
        {list.hasNextPage && !list.isFetchingNextPage && (
          <button className="dc-btn dc-btn-secondary dc-btn-block" type="button" onClick={() => list.fetchNextPage()}>加载更多</button>
        )}
      </section>
    </Desk>
  );
}

function AuditLine({ entry, names, first, to }: { entry: Entry; names: Map<string, string>; first: boolean; to: Target }) {
  const actor = entry.actor_id ? names.get(entry.actor_id) ?? '已删除的账号' : '系统';
  const what = subject(entry, names);
  const diff = changes(entry);
  const open = diff.length > 0 || !!to;
  const where = [entry.device_id && `设备 ${entry.device_id.slice(0, 8)}`, entry.ip && `IP ${entry.ip}`].filter(Boolean).join(' · ');
  return (
    <li style={first ? undefined : { borderTop: '2px dashed var(--line)' }}>
      <details>
        <summary className="dc-txn" style={{ listStyle: 'none', cursor: open ? 'pointer' : 'default' }}>
          <span className="dc-txn-icon"><Icon name={entry.action.startsWith('check.') ? 'warning' : 'bell'} /></span>
          <div className="dc-txn-main">
            <div className="dc-txn-title">{label(entry)}{what && ` · ${what}`}</div>
            <div className="dc-txn-time">{actor} · {formatTime(entry.at)}</div>
            {where && <div className="dc-txn-time">{where}</div>}
          </div>
          {open && <span style={{ width: 24, flex: 'none' }}><Icon name="expand" /></span>}
        </summary>
        {open && (
          <div className="dc-stack" style={{ paddingLeft: 'calc(52px + var(--space-3))', paddingBottom: 'var(--space-3)' }}>
            {diff.length > 0 && (
              <dl className="dc-kv">
                {diff.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
            )}
            {to && <div><a className="dc-btn dc-btn-ghost dc-btn-sm" {...link(to.href)}>{to.label}<Icon name="next" /></a></div>}
          </div>
        )}
      </details>
    </li>
  );
}
