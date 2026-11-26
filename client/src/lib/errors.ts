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
// 260 MB, 820 KB: lib/public.ts's formatSize, written here for the same reason.
function size(bytes: number) {
  let n = bytes / 1024;
  if (n < 1) return '1 KB';
  for (const unit of ['KB', 'MB', 'GB']) {
    const shown = Math.round(n * 10) / 10;
    if (shown < 1024 || unit === 'GB') return `${shown} ${unit}`;
    n /= 1024;
  }
  return '';
}

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
  anchor_params: '锚点参数', term_rates: '定期周利率', loan_multiplier: '贷款倍数', penalty_multiplier: '罚息倍数', weeks: '存期', term_id: '这笔定期',
  holding_id: '这笔理财', change: '行情涨跌', wealth_params: '理财参数',
  occurred_at: '原始发生时间', type: '类型', new: '改好的内容',
  plan: '还款方式', periods: '期数', via: '放款方式', purpose: '用途', loan_id: '这笔贷款', terminate_reason: '终止原因',
};

export function explain(code: string, d: Detail = {}): { title: string; text: string } {
  switch (code) {
    case 'STUDENT_NOT_FOUND': return { title: '未找到该学号', text: '请核对学号后重新输入。' };
    // With `at` (补录, 编辑): the moment from which 活期 would fall short.
    case 'INSUFFICIENT_BALANCE':
      if (d.wealth === 'buy') return { title: '余额不足', text: `余额不足：活期余额 ${d.balance} HTB，还差 ${d.short} HTB。` };
      return d.at ? { title: '活期会不够', text: `补录后，${shanghaiTime(String(d.at))} 起活期会不够，差 ${d.short} HTB。` }
        : { title: '余额不足', text: `可用余额 ${d.balance} HTB，还差 ${d.short} HTB，请减少金额。` };
    case 'OCCURRED_OUT_OF_RANGE': return { title: '时间不在补录范围内', text: `只能补录 ${shanghaiTime(String(d.from))} 开户以后到现在之间发生的业务。` };
    case 'WITHDRAW_SINGLE_LIMIT': return { title: '超过单笔取款限额', text: `单笔最多取款 ${d.limit} HTB。` };
    case 'WITHDRAW_DAILY_LIMIT': return { title: '超过今日取款限额', text: `今日还可取款 ${d.remaining} HTB。` };
    case 'OUT_OF_STOCK': return { title: '已售罄', text: `${d.name} 库存不足，请调整数量。` };
    case 'PRODUCT_UNLISTED': return { title: '商品已下架', text: '请重新选择商品。' };
    case 'CASH_NOT_ENOUGH': return { title: '收款不足', text: `应付 ${d.due} HTB，已收 ${d.received} HTB。` };
    // `type` (the business reversed) and `edit` (编辑) are the client's own: the server sends no detail.
    case 'REVERSAL_NOT_ALLOWED':
      if (d.edit) return { title: '不能编辑这笔流水', text: '这笔流水已经冲正或编辑过，不能再编辑。' };
      return { title: '不能冲正这笔业务', text: d.type === 'term_open' ? '这笔定期已经到期或提前支取，不能再冲正。'
        : d.type === 'term_close' ? '已过到期日，不能再冲正这笔提前支取。'
        : d.type === 'wealth_buy' ? '这笔理财已经卖出或到期，不能再冲正。'
        : d.type === 'wealth_close' ? '已过到期日，不能再冲正这笔卖出。'
        : d.type === 'loan' ? '这笔贷款已经开始还款，不能再冲正。'
        : d.type === 'repay' ? '只能冲正这笔贷款最近的一笔还款。' : '只能冲正本人今天办理的业务，其他情况请联系银行管理员。' };
    case 'REVERSAL_INSUFFICIENT_BALANCE':
      return { title: '暂不能冲正', text: `当前余额 ${d.balance} HTB，少于原存款金额，请联系银行管理员。` };
    case 'STUDENT_INACTIVE':
      if (d.wealth === 'sell') return { title: '不能卖出', text: '账户已冻结或已毕业，理财不能卖出。' };
      return { title: '账户不可办理', text: d.status === 'closed' ? '该账户已注销。' : '该账户已冻结或已毕业，请联系银行管理员。' };
    // `cash` (end: 下班, review: 复核, force: 强制下班) is the 轧账 pages' own: the server sends no such detail.
    // `currency` (the kind being recorded: baseline, issue, recover, destroy, correction) is 登记货币's own.
    case 'INVALID_AMOUNT':
      if (d.currency && d.denomination != null) return { title: `更正后 ${d.denomination} 元会少于 0 张`, text: '这笔登记加上它的全部更正，每种面额都不能少于 0 张。' };
      if (d.currency) {
        return { title: '张数不对', text: d.currency === 'correction' ? '每种面额 −100000～100000 张，不能全为 0。'
          : '每种面额 0～100000 张，合计不超过 10,000,000 HTB，不能为 0。' };
      }
      if (d.cash) return { title: '张数有误', text: '实点张数不对，请检查各面额。' };
      if (d.wealth) return { title: '金额有误', text: '金额要是 1 HTB 起的整数。' };
      return { title: '金额有误', text: d.payoff != null ? `还清本金要连利息零头一起付，全部结清是 ${d.payoff} HTB。` : '请输入正整数金额，并使用柜台列出的面额。' };
    // `today` is the page's: the server sends only the day the 理财 may be sold.
    case 'WEALTH_LOCKED': {
      const day = String(d.sellable_on);
      const tomorrow = d.today && new Date(Date.parse(`${d.today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) === day;
      return { title: '还不能卖出', text: `这笔理财${tomorrow ? '明天' : monthDay(day)}起可以卖出。` };
    }
    case 'TXN_NOT_FOUND': return { title: '未找到该业务', text: '请核对交易号。' };
    // `type` is the business a 冲正 was tried on (client's own); the server's detail is the roles that may.
    case 'FORBIDDEN':
      return { title: '没有权限', text: ['opening', 'adjust', 'term_close', 'wealth_close'].includes(String(d.type))
        ? '开户、调账、定期转回和理财转回只由银行管理员冲正。' : '当前账号不能办理这项业务。' };
    case 'LAST_SYSADMIN': return { title: '至少保留一个运维员', text: '这是最后一个在用的运维员账号，不能停用、注销或改为其他身份；请先新增一个运维员。' };
    case 'ONE_BANK_ADMIN': return { title: '银行管理员只有一个', text: '不能新增银行管理员，也不能更改银行管理员的身份。' };
    case 'INVALID_INPUT':
      if (d.currency) {
        switch (d.field) {
          case 'on_date': return { title: '日期不对', text: '日期不能晚于今天。' };
          case 'reason': return d.currency === 'issue' ? { title: '请写明用途', text: '请写明用途，最多 100 字。' } : { title: '请写明原因', text: '请写明原因，最多 100 字。' };
          case 'batch_no': return { title: '批次号不对', text: '批次号 1～40 字。' };
          case 'approver_name': return { title: '请写审批人', text: '请写审批人，最多 40 字。' };
          case 'corrects': return { title: '不能更正这笔登记', text: '只能对应一笔不是更正的登记，请重新选择。' };
          default: return { title: '没有登记', text: '请返回货币页后重新打开。' };
        }
      }
      if (d.cash && d.field === 'note') return { title: '原因太长', text: '原因最多 200 字。' };
      if (d.cash && d.field === 'reason') return { title: '请写明原因', text: '请写明强制下班的原因，最多 200 字。' };
      if (d.cash && d.field === 'count') return { title: '请录入实点', text: '这次上班没有柜员实点，请录入点出的各面额张数。' };
      if (d.cash && d.field === 'duty_id') {
        return !d.status ? { title: '找不到这次上班', text: '找不到这次上班，请刷新后再试。' }
          : d.cash === 'force' ? { title: '已经下班', text: '这位柜员已经下班了。' }
          : d.status === 'open' ? { title: '还在上班', text: '柜员还在上班，下班后才能复核。' }
          : { title: '已经复核过', text: '这次上班已经复核过了。' };
      }
      if (d.transfer && d.field === 'reason') return { title: '请写明原因', text: '请写明删除的原因，最多 200 字。' };
      if (d.transfer && d.field === 'files') return { title: '文件不对', text: '文件名要在 255 字以内，请改名后重新选择。' };
      if (d.field === 'rates') return { title: '工资标准有误', text: '工资标准每格 1～10000 HTB。' };
      if (d.field === 'user_id' && d.payroll) return { title: '不参与考勤', text: '银行管理员和运维员不参与考勤。' };
      if (d.field === 'id' && d.payroll) return { title: '不能作废', text: '待审的班次请审查。' };
      // `wealth` (buy, sell: the counter's 理财; record: 登记行情 on the 理财 page) is the pages' own: the server sends no such detail.
      if (d.wealth && d.field === 'product') return { title: '还没有选品种', text: '请选择品种。' };
      if (d.field === 'holding_id') return { title: '不能卖出', text: '这笔理财已经卖出或到期，不能再卖出。' };
      if (d.field === 'change') return { title: '行情涨跌有误', text: '行情涨跌要在 −50% 到 50% 之间，最多 4 位小数。' };
      if (d.wealth && d.field === 'day') return { title: '日期有误', text: '只能登记已经过去的工作日。' };
      if (d.wealth && d.field === 'note') return { title: '说明有误', text: '请写明数据从哪里来，最多 200 字。' };
      if (d.field === 'loan_id' && d.status) return { title: '这笔贷款不能还款', text: d.status === 'closed' ? '这笔贷款已经结清。' : '这笔贷款已经作废。' };
      return { title: '填写有误', text: `请检查${d.row ? `第 ${d.row} 行的` : ''}${FIELDS[String(d.field)] ?? '填写的内容'}。` };
    case 'ALREADY_EXISTS':
      if (d.currency && d.field === 'kind') return { title: '期初现金已经登记过', text: '期初现金只登记一次，登错了请登一笔更正。' };
      if (d.currency && d.field === 'batch_no') return { title: '批次号已经用过', text: `批次号 ${d.batch_no} 已经用过。` };
      if (d.field === 'attendance') return { title: '不能签到', text: '这个班次已经有记录。' };
      if (d.wealth && d.field === 'day') return { title: '已经有行情', text: '这一天已经有行情，不能再登记。' };
      return { title: '已存在', text: `${FIELDS[String(d.field)] ?? '这项内容'}已被使用。` };
    case 'USER_NOT_FOUND': return { title: '未找到', text: '请刷新后重试。' };
    case 'PRODUCT_NOT_FOUND': return { title: '商品不存在', text: '请刷新后重新选择商品。' };
    // `payroll` (签到, 作废, 工资账户, 参与考勤) is the attendance pages' own: the server sends no detail.
    case 'SELF_SERVICE_FORBIDDEN':
      if (d.payroll) return { title: '不能给自己签到', text: '行长的班次由银行管理员签到。' };
      return { title: '不能为自己办理', text: '这是你本人或你的工资账户，请由其他柜员办理。' };
    case 'ATTENDANCE_PAID': return { title: '已经发过工资', text: '这个班次的工资已经发放，不能作废。' };
    case 'ATTENDANCE_REVIEWED':
      if (d.payroll) return { title: '已经作废', text: '这个班次已经作废。' };
      return { title: '已经审查过', text: '审查过的班次不能再修改。' };
    case 'ATTENDANCE_PENDING': return { title: '还有班次没审查', text: `截至这周日还有 ${d.count} 个待审班次，全部审查后才能发放工资。` };
    case 'ATTENDANCE_ON': return { title: '正在参与考勤', text: '先关闭参与考勤，才能解除工资账户；更换账户可以直接绑定新的。' };
    // `sign` (签到 on 我的 or in the 考勤 table) is the attendance pages' own; otherwise it is 参与考勤 that was refused.
    case 'SALARY_UNBOUND': return { title: '还没有绑定工资账户', text: d.sign ? '先绑定工资账户，再签到。' : '先绑定工资账户，再开启参与考勤。' };
    case 'ATTENDANCE_OFF': return { title: '还没有参与考勤', text: '请银行管理员开启参与考勤后再签到。' };
    case 'STALE_DUTY':
      return { title: '上次上班还没下班', text: `这次上班从 ${shanghaiTime(String(d.started_at))} 开始，已经跨天。请先下班，再重新上班办理业务。` };
    case 'NOTE_REQUIRED':
      return d.cash === 'review' ? { title: '请写明原因', text: '点出的现金和应有不一致，写明原因后才能复核通过。' }
        : { title: '请写明原因', text: '现金和应有不一致，写明原因后才能下班。' };
    case 'OFF_DUTY': return { title: '还没有上班', text: '请先在「考勤」点「上班」，再办理业务。' };
    case 'SUMMARY_STALE': return { title: '总结需要重新生成', text: `上班后又办理了业务（共 ${d.txns} 笔），请重新生成并打印总结后再下班。` };
    case 'ACCOUNT_CLOSED': return { title: '账号已注销', text: '注销的账号不能再启用或修改。' };
    case 'WRONG_PASSWORD': return { title: '密码不对', text: '请输入该学生账户的登录密码；连续输错 5 次，该学生账号会锁定 15 分钟。' };
    case 'LOGIN_LOCKED': return { title: '该学生账号已锁定', text: '密码输错次数过多，请 15 分钟后再试。' };
    case 'CREDIT_DISABLED': return { title: '信用分已暂停', text: '暂停期间所有学生按 600 分计，不能调整。重新开启后再调整。' };
    case 'CREDIT_TOO_LOW': return { title: '信用分不够', text: `信用分 ${d.min_score} 分以上才能贷款，现在是 ${d.score} 分。` };
    case 'OVER_CREDIT_LIMIT': return { title: '超过贷款额度', text: `按现在的信用分，最多能贷 ${d.limit} HTB。` };
    case 'REPAY_TOO_MUCH': return { title: '还款金额太多', text: `这笔贷款现在一共只需还 ${d.max} HTB。` };
    // On 注销 the server names the student by number; the page passes the `name` it lists. `wealth` (买理财) is the counter's own.
    case 'LOAN_OUTSTANDING':
      return { title: '还有贷款没还清', text: d.loan_no ? `${d.name ?? `学号 ${d.student_no}`} 还有贷款没还清，结清后才能注销。`
        : d.wealth ? '先还清这笔贷款，才能买理财。' : '先还清这笔贷款，才能办新贷款或新定期。' };
    case 'TERM_OPEN_ITEMS': return { title: '还不能结转', text: '下面这些处理完后，再结转学期。' };
    case 'TERM_OVERLAP': return { title: '学期日期重叠', text: `和「${d.term}」的日期重叠，请调整开始日或结束日。` };
    case 'TERM_NOT_ENDED': return { title: '学期还没结束', text: `${monthDay(String(d.ends_on))} 之后才能结转。` };
    case 'TERM_CLOSED': return { title: '学期已结转', text: '结转后的学期不能再修改。' };
    case 'ALERT_HANDLED':
      return { title: '这条提醒已处理', text: `${d.handler_name ?? ''} 已于 ${shanghaiTime(String(d.handled_at))} ${d.status === 'terminated' ? '终止' : '标为已查看'}。` };
    case 'ALERT_OUTDATED': return { title: '参数之后又改过', text: '这项参数在提醒之后又改过，请先终止后来的那条提醒，或到参数页直接修改。' };
    // 文件传输 (design system FileTransfer): `transfer` (send, receive, admin) is the pages' own: the server sends no such detail.
    case 'TRANSFER_NOT_FOUND':
      return d.transfer === 'admin' ? { title: '这次取件已经不在了', text: '' }
        : d.transfer === 'send' ? { title: '这次发送已失效', text: '这次发送已失效，请重新选择文件。' }
        : { title: '取件码不对或已过期', text: '请核对 4 位取件码。取件码在生成后 7 天内有效。' };
    case 'TRANSFER_INCOMPLETE': return { title: '没有传完', text: '请检查网络后点重试。' };
    case 'FILE_TOO_LARGE':
      if (d.field === 'count') return { title: '文件太多', text: `这次选了 ${d.count} 个，一次至多 ${d.max} 个，请分几次发送。` };
      if (d.field === 'total') return { title: '合计太大', text: `这次选了 ${size(Number(d.total))}，合计不能超过 ${size(Number(d.max))}，请分几次发送。` };
      return { title: '文件太大', text: `${((d.files ?? []) as { name: string; size: number }[]).map((f) => `${f.name} 有 ${size(f.size)}`).join('、')}，每个文件不能超过 ${size(Number(d.max))}。` };
    case 'STORAGE_FULL': return { title: '存储空间已满', text: '存储空间已满，请过几天再试。' };
    case 'RATE_LIMITED':
      return d.transfer === 'send' ? { title: '上传次数太多', text: '同一网络每小时至多上传 10 次，请稍后再试。' }
        : { title: '输错次数太多', text: '请 10 分钟后再试。' };
    case 'NETWORK':
      if (d.transfer === 'send') return { title: '没有传完', text: '请检查网络后点重试。' };
      if (d.transfer) return { title: '暂时连不上', text: '请检查网络后再试。' };
      return { title: '网络已断开', text: '联网后再办理这项业务；存款可以继续离线登记。' };
    default: return { title: '暂时无法办理', text: '请稍后重试；多次出现时请联系银行管理员。' };
  }
}

// A refusal of handle_alert (design system RiskAlerts 没有处理成功) for an alert of `kind`. The undo's own refusals keep
// their text, under 没有终止, and say the alert can still be marked 已查看.
export function alertRefusal(code: string, d: Detail, kind: string) {
  if (code === 'INVALID_INPUT' && d.field === 'note') return { title: '请写明原因', text: '请写明终止的原因，最多 200 字。' };
  if (code === 'INVALID_INPUT' && d.field === 'action') return { title: '不能终止', text: '这种提醒只能标为已查看。' };
  if (code === 'INVALID_INPUT' && d.field === 'id') return { title: '找不到这条提醒', text: '找不到这条提醒，请刷新后再试。' };
  const undo = code === 'REVERSAL_NOT_ALLOWED' || code === 'REVERSAL_INSUFFICIENT_BALANCE' || code === 'CREDIT_DISABLED'
    || (code === 'INVALID_INPUT' && (d.field === 'loan_id' || d.field === 'duty_id'));
  if (!undo) return explain(code, d);
  // The bank admin may reverse any 取款, so a refused one was reversed or edited already.
  const text = code === 'REVERSAL_NOT_ALLOWED' && kind === 'withdraw_large' ? '这笔取款已经冲正或编辑过。'
    : explain(code, d.field === 'duty_id' ? { ...d, cash: 'force', status: d.status ?? 'ended' } // the alert's duty exists: it has ended
      : { ...d, type: kind === 'term_early' ? 'term_close' : undefined }).text;
  return { title: '没有终止', text: `${text}可以改为已查看。` };
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
