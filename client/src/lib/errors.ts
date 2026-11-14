// 11月9日 07:45 on the school's clock (Asia/Shanghai). Written here rather than taken from lib/format, so this file loads
// on its own, as the unit tests load it.
function shanghaiTime(iso: string) {
  const t = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${t.month}月${t.day}日 ${t.hour}:${t.minute}`;
}
// 2027-01-20 → 1月20日.
const monthDay = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;

// Error codes from the database functions (app_private.fail) as the counter shows them (PHASE-1.md §7.6).
export type Detail = Record<string, unknown>;

export class AppError extends Error {
  code: string;
  detail: Detail;
  constructor(code: string, detail: Detail = {}) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

const FIELDS: Record<string, string> = {
  reason: '冲正原因', items: '商品', payment: '付款方式', login_id: '账号', role: '身份', user_id: '账号',
  cohort: '学届', opening_balance: '期初余额', qty: '入库数量', product: '商品名称和价格', issue: '发行信息', batch_no: '批次号',
  denominations: '面额', withdraw_single_limit: '单笔取款上限', withdraw_daily_limit: '单日取款上限', ranking_size: '排名人数',
  promotion_date: '升年级日期', ranking_anonymous: '排名匿名', key: '参数', rates: '工资标准',
  account: '工资账户', attendance: '班次', shift: '班次', day: '日期', note: '说明', status: '审核结果', week: '发放的周',
  name: '名称', starts_on: '开始日', ends_on: '结束日', credit_curve: '信用分的计算参数', credit_rules: '加减分规则',
  anchor_params: '锚点参数', term_multipliers: '定期倍数', loan_multiplier: '贷款倍数', penalty_multiplier: '罚息倍数', weeks: '存期', term_id: '这笔定期',
  plan: '还款方式', periods: '期数', via: '放款方式', purpose: '用途', loan_id: '这笔贷款', terminate_reason: '终止原因',
};

export function explain(code: string, d: Detail = {}): { title: string; text: string } {
  switch (code) {
    case 'STUDENT_NOT_FOUND': return { title: '未找到该学号', text: '请核对学号后重新输入。' };
    case 'INSUFFICIENT_BALANCE': return { title: '余额不足', text: `可用余额 ${d.balance} HTB，还差 ${d.short} HTB，请减少金额。` };
    case 'WITHDRAW_SINGLE_LIMIT': return { title: '超过单笔取款限额', text: `单笔最多取款 ${d.limit} HTB。` };
    case 'WITHDRAW_DAILY_LIMIT': return { title: '超过今日取款限额', text: `今日还可取款 ${d.remaining} HTB。` };
    case 'OUT_OF_STOCK': return { title: '已售罄', text: `${d.name} 库存不足，请调整数量。` };
    case 'PRODUCT_UNLISTED': return { title: '商品已下架', text: '请重新选择商品。' };
    case 'CASH_NOT_ENOUGH': return { title: '收款不足', text: `应付 ${d.due} HTB，已收 ${d.received} HTB。` };
    // `type` (the business reversed) is the client's own: the server sends no detail.
    case 'REVERSAL_NOT_ALLOWED':
      return { title: '不能冲正这笔业务', text: d.type === 'term_open' ? '这笔定期已经到期或提前支取，不能再冲正。'
        : d.type === 'term_close' ? '已过到期日，不能再冲正这笔提前支取。'
        : d.type === 'loan' ? '这笔贷款已经开始还款，不能再冲正。'
        : d.type === 'repay' ? '只能冲正这笔贷款最近的一笔还款。' : '只能冲正本人今天办理的业务，其他情况请联系银行管理员。' };
    case 'REVERSAL_INSUFFICIENT_BALANCE':
      return { title: '暂不能冲正', text: `当前余额 ${d.balance} HTB，少于原存款金额，请联系银行管理员。` };
    case 'STUDENT_INACTIVE':
      return { title: '账户不可办理', text: d.status === 'closed' ? '该账户已注销。' : '该账户已冻结或已毕业，请联系银行管理员。' };
    case 'INVALID_AMOUNT':
      return { title: '金额有误', text: d.payoff != null ? `还清本金要连利息零头一起付，全部结清是 ${d.payoff} HTB。` : '请输入正整数金额，并使用柜台列出的面额。' };
    case 'TXN_NOT_FOUND': return { title: '未找到该业务', text: '请核对交易号。' };
    case 'FORBIDDEN': return { title: '没有权限', text: '当前账号不能办理这项业务。' };
    case 'LAST_SYSADMIN': return { title: '至少保留一个运维员', text: '这是最后一个在用的运维员账号，不能停用、注销或改为其他身份；请先新增一个运维员。' };
    case 'ONE_BANK_ADMIN': return { title: '银行管理员只有一个', text: '不能新增银行管理员，也不能更改银行管理员的身份。' };
    case 'INVALID_INPUT':
      if (d.field === 'rates') return { title: '工资标准有误', text: '工资标准每格 1～10000 HTB。' };
      if (d.field === 'user_id' && d.payroll) return { title: '不参与考勤', text: '运维员不参与考勤。' };
      if (d.field === 'loan_id' && d.status) return { title: '这笔贷款不能还款', text: d.status === 'closed' ? '这笔贷款已经结清。' : '这笔贷款已经作废。' };
      return { title: '填写有误', text: `请检查${d.row ? `第 ${d.row} 行的` : ''}${FIELDS[String(d.field)] ?? '填写的内容'}。` };
    case 'ALREADY_EXISTS':
      if (d.field === 'attendance') return { title: '已经登记过', text: '这个班次已经有记录。' };
      return { title: '已存在', text: `${FIELDS[String(d.field)] ?? '这项内容'}已被使用。` };
    case 'USER_NOT_FOUND': return { title: '未找到', text: '请刷新后重试。' };
    case 'PRODUCT_NOT_FOUND': return { title: '商品不存在', text: '请刷新后重新选择商品。' };
    // `payroll` (登记, 作废, 工资账户, 参与考勤) is the attendance pages' own: the server sends no detail.
    case 'SELF_SERVICE_FORBIDDEN':
      if (d.payroll) return { title: '不能登记自己的班次', text: '行长的班次由银行管理员登记，银行管理员的由行长登记。' };
      return { title: '不能为自己办理', text: '这是你本人或你的工资账户，请由其他柜员办理。' };
    case 'ATTENDANCE_PAID': return { title: '已经发过工资', text: '这个班次的工资已经发放，不能作废。' };
    case 'ATTENDANCE_REVIEWED':
      if (d.payroll) return { title: '已经作废', text: '这个班次已经作废。' };
      return { title: '已经审查过', text: '审查过的班次不能再修改。' };
    case 'ATTENDANCE_PENDING': return { title: '还有班次没审查', text: `截至这周日还有 ${d.count} 个待审班次，全部审查后才能发放工资。` };
    case 'ATTENDANCE_ON': return { title: '正在参与考勤', text: '先关闭参与考勤，才能解除工资账户；更换账户可以直接绑定新的。' };
    case 'SALARY_UNBOUND': return { title: '还没有绑定工资账户', text: '绑定学生账户作为工资账户后，才能参与考勤。' };
    case 'STALE_DUTY':
      return { title: '上次上班还没下班', text: `这次上班从 ${shanghaiTime(String(d.started_at))} 开始，已经跨天。请先下班，再重新上班办理业务。` };
    case 'OFF_DUTY': return { title: '还没有上班', text: '请先在「考勤」点「上班」，再办理业务。' };
    case 'SUMMARY_STALE': return { title: '总结需要重新生成', text: `上班后又办理了业务（共 ${d.txns} 笔），请重新生成并打印总结后再下班。` };
    case 'ACCOUNT_CLOSED': return { title: '账号已注销', text: '注销的账号不能再启用或修改。' };
    case 'WRONG_PASSWORD': return { title: '密码不对', text: '请输入该学生账户的登录密码；连续输错 5 次，该学生账号会锁定 15 分钟。' };
    case 'LOGIN_LOCKED': return { title: '该学生账号已锁定', text: '密码输错次数过多，请 15 分钟后再试。' };
    // `business` (开定期) is the counter's own: the server sends no detail.
    case 'NO_TERM': return { title: '现在不在学期内', text: d.business ? `现在不在学期内，不能${d.business}。` : '还没有登记当前学期，暂时不能办理贷款和定期。' };
    case 'TERM_TOO_LONG':
      return { title: '存期超过学期末', text: `本学期 ${monthDay(String(d.ends_on))} 结束，${d.max_weeks == null ? '已经放不下定期' : `最长只能选 ${d.max_weeks} 周`}。` };
    case 'CREDIT_TOO_LOW': return { title: '信用分不够', text: `信用分 ${d.min_score} 分以上才能贷款，现在是 ${d.score} 分。` };
    case 'OVER_CREDIT_LIMIT': return { title: '超过贷款额度', text: `按现在的信用分，最多能贷 ${d.limit} HTB。` };
    case 'REPAY_TOO_MUCH': return { title: '还款金额太多', text: `这笔贷款现在一共只需还 ${d.max} HTB。` };
    // On 注销 the server names the student by number; the page passes the `name` it lists.
    case 'LOAN_OUTSTANDING':
      return { title: '还有贷款没还清', text: d.loan_no ? `${d.name ?? `学号 ${d.student_no}`} 还有贷款没还清，结清后才能注销。` : '先还清这笔贷款，才能办新贷款或新定期。' };
    case 'TERM_OPEN_ITEMS': return { title: '还不能结转', text: '下面这些处理完后，再结转学期。' };
    case 'TERM_OVERLAP': return { title: '学期日期重叠', text: `和「${d.term}」的日期重叠，请调整开始日或结束日。` };
    case 'TERM_NOT_ENDED': return { title: '学期还没结束', text: `${monthDay(String(d.ends_on))} 之后才能结转。` };
    case 'TERM_CLOSED': return { title: '学期已结转', text: '结转后的学期不能再修改。' };
    case 'NETWORK': return { title: '网络已断开', text: '联网后再办理这项业务；存款可以继续离线登记。' };
    default: return { title: '暂时无法办理', text: '请稍后重试；多次出现时请联系银行管理员。' };
  }
}

// Auth error codes of a sign-in → what the person can do about it. The lockout (5 wrong passwords in 15 minutes) comes
// from the database's password check hook as invalid_credentials with the message LOGIN_LOCKED.
export function loginError(code?: string) {
  if (code === 'user_banned') return { title: '这个账号已被停用', text: '停用的账号不能登录。需要恢复时，请联系银行管理员启用。' };
  if (code === 'over_request_rate_limit') return { title: '尝试次数过多', text: '请稍后再登录。' };
  if (code === 'invalid_credentials') return { title: '账号或密码不正确', text: '请核对后重新输入。' };
  if (code === 'LOGIN_LOCKED') return { title: '密码输错次数过多', text: '请 15 分钟后再试，或请银行管理员重置密码。' };
  return { title: '暂时无法登录', text: '请检查网络后重试。' };
}
