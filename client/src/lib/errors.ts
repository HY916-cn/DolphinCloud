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
  promotion_date: '升年级日期', ranking_anonymous: '排名匿名', key: '参数', salary_per_shift: '每班次工资',
  account: '工资账户', attendance: '班次', shift: '班次', day: '日期', note: '补签说明', status: '审核结果', week: '发放的周',
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
    case 'REVERSAL_NOT_ALLOWED': return { title: '不能冲正这笔业务', text: '只能冲正本人今天办理的业务，其他情况请联系银行管理员。' };
    case 'REVERSAL_INSUFFICIENT_BALANCE':
      return { title: '暂不能冲正', text: `当前余额 ${d.balance} HTB，少于原存款金额，请联系银行管理员。` };
    case 'STUDENT_INACTIVE': return { title: '账户不可办理', text: '该账户已冻结或已毕业，请联系银行管理员。' };
    case 'INVALID_AMOUNT': return { title: '金额有误', text: '请输入正整数金额，并使用柜台列出的面额。' };
    case 'TXN_NOT_FOUND': return { title: '未找到该业务', text: '请核对交易号。' };
    case 'FORBIDDEN': return { title: '没有权限', text: '当前账号不能办理这项业务。' };
    case 'ONE_BANK_ADMIN': return { title: '银行管理员只有一个', text: '不能新增银行管理员，也不能更改银行管理员的身份。' };
    case 'INVALID_INPUT':
      return { title: '填写有误', text: `请检查${d.row ? `第 ${d.row} 行的` : ''}${FIELDS[String(d.field)] ?? '填写的内容'}。` };
    case 'ALREADY_EXISTS': return { title: '已存在', text: `${FIELDS[String(d.field)] ?? '这项内容'}已被使用。` };
    case 'USER_NOT_FOUND': return { title: '未找到', text: '请刷新后重试。' };
    case 'PRODUCT_NOT_FOUND': return { title: '商品不存在', text: '请刷新后重新选择商品。' };
    case 'SELF_SERVICE_FORBIDDEN': return { title: '不能为自己办理', text: '这是你本人或你的工资账户，请由其他柜员办理。' };
    case 'ATTENDANCE_OFF': return { title: '还没有参与考勤', text: '请联系银行管理员开启后再签到。' };
    case 'ATTENDANCE_PAID': return { title: '工资已发放', text: '已发工资的班次不能再修改。' };
    case 'WRONG_PASSWORD': return { title: '密码不对', text: '请输入该学生账户的登录密码；连续输错 5 次，该学生账号会锁定 15 分钟。' };
    case 'LOGIN_LOCKED': return { title: '该学生账号已锁定', text: '密码错误次数过多，请 15 分钟后再试。' };
    case 'NETWORK': return { title: '网络已断开', text: '联网后再办理这项业务；存款可以继续离线登记。' };
    default: return { title: '暂时无法办理', text: '请稍后重试；多次出现时请联系银行管理员。' };
  }
}
