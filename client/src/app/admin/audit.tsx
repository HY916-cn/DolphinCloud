import { useInfiniteQuery } from '@tanstack/react-query';
import { Desk, Icon, Notice, TxnListLoading } from '@/components';
import { describeCash, type Counts } from '@/lib/cash';
import { formatTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';

const PAGE = 50;
type Entry = {
  id: number; at: string; actor_id: string | null; action: string; target: string | null;
  before: unknown; after: unknown; ip: string | null; device_id: string | null;
};
type Row = Record<string, unknown>;

// Function logs (PHASE-1.md §5.5) and the trigger rows "<table>.<insert|update|delete>" (app_private.audit_row).
const ACTIONS: Record<string, string> = {
  'roster.import': '名册导入', 'user.reset_password': '重置密码', 'txn.reverse': '冲正', 'check.mismatch': '余额自检不一致',
};
const TABLES: Record<string, string> = {
  students: '学生', profiles: '账号', user_roles: '身份', products: '商品', currency_issues: '发行', settings: '参数',
};
const OPS: Record<string, string> = { insert: '新增', update: '修改', delete: '删除' };
const SETTINGS: Record<string, string> = {
  denominations: '面额', withdraw_single_limit: '单笔取款上限', withdraw_daily_limit: '单日取款上限',
  ranking_anonymous: '排名匿名', ranking_size: '排名人数', promotion_date: '升年级日期',
};
const COLUMNS: Record<string, string> = {
  name: '名称', display_name: '姓名', login_id: '账号', disabled: '停用', must_change_password: '需要修改密码', role: '身份',
  student_no: '学号', division: '学部', cohort: '学届', class_no: '班号', class_label: '班级名称', status: '状态',
  price: '价格', cost: '成本', category: '分类', listed: '上架', stock: '库存', safety_stock: '安全库存', image_path: '图片',
  batch_no: '批次号', issued_on: '发行日期', denominations: '面额', total: '总额', purpose: '用途', approver_name: '审批人',
  value: '取值', type: '类型', amount: '金额', balance_delta: '余额变动', balance_after: '办理后余额', reason: '原因',
  txn_no: '交易号', created: '新开账户', updated: '更新学生',
};
// Columns that change on every write and say nothing to the reader.
const NOISE = new Set(['id', 'seq', 'created_at', 'updated_at', 'updated_by', 'created_by', 'opened_at', 'user_id', 'operator_id', 'device_id']);
const WORDS: Record<string, string> = {
  primary: '小学部', junior: '初中部', normal: '正常', frozen: '冻结', graduated: '毕业', reversed: '已冲正',
  teller: '柜员', accountant: '会计', storekeeper: '库管', teacher: '银行管理员', sysadmin: '运维员',
};

const asRow = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});

function label(e: Entry) {
  const [table, op] = e.action.split('.');
  return ACTIONS[e.action] ?? (TABLES[table] && OPS[op] ? `${OPS[op]}${TABLES[table]}` : e.action);
}

const profileOf = (e: Entry) => (e.target?.startsWith('profiles:') ? e.target.slice(9) : null);

// What the entry is about, in the row's own words: the batch, student, product, login or setting; for a reversal the
// original transaction, for a password reset the login.
function subject(e: Entry, names: Map<string, string>) {
  const r = e.action === 'txn.reverse' ? asRow(e.before) : { ...asRow(e.before), ...asRow(e.after) };
  if (e.action === 'user.reset_password') return names.get(profileOf(e) ?? '') ?? '';
  if (e.action.startsWith('settings.')) return SETTINGS[String(r.key)] ?? String(r.key ?? '');
  if (e.action === 'check.mismatch') return `${Array.isArray(e.after) ? e.after.length : 0} 处不一致`;
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

// 日志 (teacher, sysadmin): the audit log, newest first, 50 at a time; a row opens to show what changed.
export default function Audit() {
  const list = useInfiniteQuery({
    queryKey: ['audit-log'],
    initialPageParam: 0,
    getNextPageParam: (last: { entries: Entry[]; names: Map<string, string> }, pages) => (last.entries.length === PAGE ? pages.length : undefined),
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.from('audit_log').select('id,at,actor_id,action,target,before,after,ip,device_id')
        .order('id', { ascending: false }).range(pageParam * PAGE, pageParam * PAGE + PAGE - 1);
      if (error) throw error;
      const entries = data as Entry[];
      const ids = [...new Set(entries.flatMap((e) => [e.actor_id, profileOf(e)].filter((id): id is string => !!id)))];
      const names = new Map<string, string>();
      if (ids.length) {
        const { data: people, error: e } = await supabase.from('profiles').select('id,display_name').in('id', ids);
        if (e) throw e;
        for (const p of people) names.set(p.id, p.display_name);
      }
      return { entries, names };
    },
  });
  const pages = list.data?.pages;

  return (
    <Desk title="日志">
      <section className="dc-stack dc-enter" aria-label="操作日志">
        {list.error && !pages ? (
          <Notice tone="danger" title="暂时无法读取日志">请检查网络后刷新页面。</Notice>
        ) : !pages ? (
          <TxnListLoading />
        ) : pages[0].entries.length ? (
          <>
            <ul className="dc-txns">
              {pages.flatMap(({ entries, names }) => entries.map((e) => ({ e, names }))).map(({ e, names }, i) => (
                <AuditLine key={e.id} first={!i} entry={e} names={names} />
              ))}
            </ul>
            {list.isFetchingNextPage && <TxnListLoading rows={2} />}
          </>
        ) : (
          <div className="dc-card">
            <div className="dc-empty">
              <span className="dc-empty-icon"><Icon name="inbox" /></span>
              <h3>还没有操作日志</h3>
              <p>导入名册、修改参数等操作会记录在这里。</p>
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

function AuditLine({ entry, names, first }: { entry: Entry; names: Map<string, string>; first: boolean }) {
  const actor = entry.actor_id ? names.get(entry.actor_id) ?? '已删除的账号' : '系统';
  const what = subject(entry, names);
  const diff = changes(entry);
  const where = [entry.device_id && `设备 ${entry.device_id.slice(0, 8)}`, entry.ip && `IP ${entry.ip}`].filter(Boolean).join(' · ');
  return (
    <li style={first ? undefined : { borderTop: '2px dashed var(--line)' }}>
      <details>
        <summary className="dc-txn" style={{ listStyle: 'none', cursor: diff.length ? 'pointer' : 'default' }}>
          <span className="dc-txn-icon"><Icon name={entry.action.startsWith('check.') ? 'warning' : 'bell'} /></span>
          <div className="dc-txn-main">
            <div className="dc-txn-title">{label(entry)}{what && ` · ${what}`}</div>
            <div className="dc-txn-time">{actor} · {formatTime(entry.at)}</div>
            {where && <div className="dc-txn-time">{where}</div>}
          </div>
          {diff.length > 0 && <span style={{ width: 24, flex: 'none' }}><Icon name="expand" /></span>}
        </summary>
        {diff.length > 0 && (
          <dl className="dc-kv" style={{ paddingLeft: 'calc(52px + var(--space-3))' }}>
            {diff.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        )}
      </details>
    </li>
  );
}
