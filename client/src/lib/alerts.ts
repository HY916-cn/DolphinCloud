// 风险提醒 (PHASE-2.md §12, design system RiskAlerts): each kind's name and icon, an alert's object and 说明 from its
// `detail`, the rows of its page, and what 终止 does. lib/format's and lib/cash's writing is copied so this file loads
// on its own, as the unit tests load it: 1,280 HTB; 12月4日 10:20; 少 2 HTB.
import type { IconName } from '../theme/icons';

export type AlertKind = 'loan_large' | 'loan_overdue' | 'withdraw_large' | 'term_early' | 'reversal_many' | 'ops_frequent'
  | 'setting_change' | 'credit_adjust' | 'stock_low' | 'cash_unbalanced' | 'manual_entry' | 'txn_correct' | 'credit_switch';
export type AlertStatus = 'open' | 'seen' | 'terminated';
// One alert as list_risk_alerts, risk_alert_overview and handle_alert return it (§15).
export type Alert = {
  id: number; at: string; kind: AlertKind; target: string; student_no: string | null; student_name: string | null;
  staff_id: string | null; staff_name: string | null; detail: Record<string, any>; status: AlertStatus;
  handled_by: string | null; handler_name: string | null; handled_at: string | null; note: string | null; terminable: boolean;
};

export const KINDS: Record<AlertKind, { name: string; icon: IconName }> = {
  loan_large: { name: '大额贷款', icon: 'loan' },
  loan_overdue: { name: '贷款逾期', icon: 'loan' },
  withdraw_large: { name: '大额取款', icon: 'withdraw' },
  term_early: { name: '提前支取', icon: 'savings' },
  reversal_many: { name: '冲正过多', icon: 'back' },
  ops_frequent: { name: '频繁操作', icon: 'clock' },
  setting_change: { name: '参数修改', icon: 'settings' },
  credit_adjust: { name: '信用分调整', icon: 'gauge' },
  stock_low: { name: '库存不足', icon: 'inbox' },
  cash_unbalanced: { name: '轧账不平', icon: 'balance' },
  manual_entry: { name: '补录流水', icon: 'passbook' },
  txn_correct: { name: '编辑流水', icon: 'passbook' },
  credit_switch: { name: '信用分开关', icon: 'gauge' },
};
// The kinds as FilterBar's chips take them.
export const KIND_CHIPS = Object.entries(KINDS).map(([k, { name }]) => [k, name] as const);

const amount = (n: number) => `${Math.abs(n).toLocaleString('en-US')} HTB`;
const minus = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US')}`;
const SHANGHAI = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
});
const clockParts = (iso: string) => Object.fromEntries(SHANGHAI.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
// 12月4日 10:20, and 10:20 alone under its day's title.
export function clock(iso: string, timeOnly = false) {
  const t = clockParts(iso);
  return timeOnly ? `${t.hour}:${t.minute}` : `${t.month}月${t.day}日 ${t.hour}:${t.minute}`;
}
// The day an alert falls on, Asia/Shanghai: its key for grouping and the list's title "12月4日 周五".
export function alertDay(iso: string) {
  const t = clockParts(iso);
  return { key: `${t.month}-${t.day}`, title: `${t.month}月${t.day}日 ${t.weekday}` };
}

const TXN_TYPES: Record<string, string> = { deposit: '存款', withdraw: '取款', purchase: '兑换', adjust: '调账' };

// 轧账 differences per face (counted − expected): 少 2 HTB, 多 1 HTB, 面额不对; the faces "5 元少 1 张，2 元多 1 张".
type Counts = Record<string, number>;
function diffAmount(diff: Counts) {
  const total = Object.entries(diff).reduce((s, [face, n]) => s + Number(face) * n, 0);
  return total > 0 ? `多 ${amount(total)}` : total < 0 ? `少 ${amount(total)}` : '面额不对';
}
const diffFaces = (diff: Counts) => Object.entries(diff).filter(([, n]) => n !== 0).sort(([a], [b]) => Number(b) - Number(a))
  .map(([face, n]) => `${face} 元${n > 0 ? '多' : '少'} ${Math.abs(n)} 张`).join('，');

// Parameters by the names the 参数 page gives them; a key it does not show keeps its own name.
const SETTINGS: Record<string, string> = {
  denominations: '面额', withdraw_single_limit: '单笔取款上限', withdraw_daily_limit: '单日取款上限', ranking_size: '排名人数',
  ranking_anonymous: '排名匿名', promotion_date: '升年级日期', term_rates: '定期周利率', anchor_params: '锚点', wealth_params: '理财',
  credit_curve: '信用分', credit_rules: '加减分规则', risk_rules: '风险提醒', salary_rates: '工资标准',
  payout_ratio_min: '兑付能力提示线',
};
export const settingName = (key: string) => SETTINGS[key] ?? key;

// The items of a parameter made of several values, as the 参数 page labels them, with their unit.
const ITEMS: Record<string, Record<string, [string, string]>> = {
  withdraw_single_limit: { primary: ['小学部', 'HTB'], junior: ['初中部', 'HTB'] },
  withdraw_daily_limit: { primary: ['小学部', 'HTB'], junior: ['初中部', 'HTB'] },
  anchor_params: { initial: ['初始锚点', '%'], min: ['锚点下限', '%'], max: ['锚点上限', '%'] },
  credit_curve: {
    min_score: ['能贷款的最低分', '分'], limit_min: ['最低分时的额度', 'HTB'], limit_max: ['1000 分时的额度', 'HTB'], limit_step: ['取整单位', 'HTB'],
    loan_max: ['最低分时的贷款系数', '×'], loan_min: ['1000 分时的贷款系数', '×'], saving_min: ['0 分时的储蓄系数', '×'], saving_max: ['1000 分时的储蓄系数', '×'],
  },
  credit_rules: {
    repay_on_time: ['按时还清一期', '分'], repay_early: ['提前还清一笔贷款', '分'], overdue: ['逾期', '分'], overdue_week: ['逾期后每满一周', '分'],
    deposit_week: ['上周有存款', '分'], deposit_streak: ['连续 4 周都有存款', '分'], withdraw_half: ['上周取款超过余额的一半', '分'],
    account_age: ['开户每满 4 周', '分'], balance_100: ['上周日均余额 100 HTB 以上', '分'], balance_300: ['上周日均余额 300 HTB 以上', '分'],
  },
  risk_rules: {
    loan_amount: ['大额贷款：金额超过', 'HTB'], loan_score: ['大额贷款：信用分低于', '分'], withdraw_ratio: ['大额取款：超过单笔限额的', '%'],
    reversals: ['冲正过多：柜员每天冲正达到', '笔'], ops_count: ['频繁操作：同一学生办理达到', '笔'], ops_minutes: ['频繁操作：在多少分钟内', '分钟'],
  },
  wealth_params: { symbol: ['指数代码', ''], name: ['指数名称', ''], factor: ['系数', '×'] },
};
const ROLE_NAMES: Record<string, string> = { teller: '柜员', accountant: '财务', storekeeper: '库管', president: '行长' };
const TIER_ITEMS: Record<string, [string, string]> = { name: ['名称', ''], multiplier: ['倍率', '×'], max: ['每天最多赚', '%'], min: ['每天最多亏', '%'] };

// One item's name and unit by its path in the value ("2" of term_rates, "teller.am" of salary_rates, "tiers.0.max").
function item(key: string, path: string[]): [string, string] {
  const [a, b, c] = path;
  if (key === 'term_rates') return [`${a} 周`, '%'];
  if (key === 'salary_rates') return [`${ROLE_NAMES[a] ?? a}${b === 'am' ? '中午班' : b === 'pm' ? '下午班' : b}`, 'HTB'];
  if (key === 'wealth_params' && a === 'base') return [`${b} 周基础收益`, '%'];
  if (key === 'wealth_params' && a === 'tiers') return [`档位 ${Number(b) + 1} ${TIER_ITEMS[c]?.[0] ?? c}`, TIER_ITEMS[c]?.[1] ?? ''];
  return ITEMS[key]?.[path.join('.')] ?? [path.join('.'), ''];
}
const UNITS: Record<string, string> = { ranking_size: '名', denominations: '元', payout_ratio_min: '%' };

// A value with its unit: 100 HTB, 2.5%, ×1.8, 5 分, 开启, 9月1日, 1、2、5、10 元.
function valueText(v: unknown, unit: string) {
  if (typeof v === 'boolean') return v ? '开启' : '关闭';
  if (Array.isArray(v)) return `${v.join('、')}${unit ? ` ${unit}` : ''}`;
  if (typeof v === 'string') return /^\d\d-\d\d$/.test(v) ? `${Number(v.slice(0, 2))}月${Number(v.slice(3))}日` : v;
  if (typeof v !== 'number') return v == null ? '—' : JSON.stringify(v);
  const n = unit === 'HTB' ? minus(v) : `${v < 0 ? '−' : ''}${Math.abs(v)}`;
  return unit === '×' ? `×${n}` : unit === '%' ? `${n}%` : unit ? `${n} ${unit}` : n;
}

// The values of a parameter that changed, as [name, before, after]: one row for a plain value, one per item of a group.
export function settingItems(key: string, before: unknown, after: unknown): [string, string, string][] {
  const leaves = (v: unknown, path: string[] = [], out = new Map<string, [string[], unknown]>()) => {
    // A list of plain values (面额) is one value; a list of objects (理财's tiers) is one item per field.
    if (v && typeof v === 'object' && !(Array.isArray(v) && v.every((x) => typeof x !== 'object'))) {
      Object.entries(v).forEach(([k, x]) => leaves(x, [...path, k], out));
    }
    else out.set(path.join('.'), [path, v]);
    return out;
  };
  if (!before || typeof before !== 'object' || Array.isArray(before)) {
    const unit = UNITS[key] ?? (key.startsWith('withdraw_') ? 'HTB' : '');
    return [[settingName(key), valueText(before, unit), valueText(after, unit)]];
  }
  const was = leaves(before);
  const now = leaves(after);
  return [...new Set([...was.keys(), ...now.keys()])]
    .filter((p) => JSON.stringify(was.get(p)?.[1]) !== JSON.stringify(now.get(p)?.[1]))
    .map((p) => {
      const [name, unit] = item(key, (was.get(p) ?? now.get(p))![0]);
      return [name, valueText(was.get(p)?.[1], unit), valueText(now.get(p)?.[1], unit)];
    });
}
// The parameters set as a whole group (利率、信用分、理财、风险提醒、工资标准): 参数修改 counts the values that changed.
const GROUPS = new Set(['term_rates', 'anchor_params', 'credit_curve', 'credit_rules', 'wealth_params', 'risk_rules', 'salary_rates']);
const isGroup = (d: Record<string, unknown>) => GROUPS.has(String(d.key));
// A value or two (a 取款限额's divisions) said in words: "从 100 HTB 改为 150 HTB", "小学部从 100 HTB 改为 150 HTB".
const changeText = (key: string, items: [string, string, string][]) =>
  items.map(([name, was, now]) => `${name === settingName(key) ? '' : name}从 ${was} 改为 ${now}`).join('；');
const backText = (key: string, items: [string, string, string][]) =>
  items.map(([name, was]) => (name === settingName(key) ? was : `${name} ${was}`)).join('、');

// The student, teller, product or parameter an alert is about.
export function alertObject(a: Alert) {
  const d = a.detail;
  if (a.kind === 'reversal_many' || a.kind === 'cash_unbalanced') return a.staff_name ?? '柜员';
  if (a.kind === 'setting_change') return settingName(String(d.key));
  if (a.kind === 'stock_low') return String(d.name);
  if (a.kind === 'credit_switch') return '全部学生';
  return a.student_name ?? a.student_no ?? '';
}

// The 说明 of each kind (design system RiskAlerts 说明), from its detail.
export function alertText(a: Alert) {
  const d = a.detail;
  switch (a.kind) {
    case 'loan_large': {
      const parts = [
        d.amount > d.loan_amount && `贷款 ${amount(d.amount)}，超过 ${amount(d.loan_amount)}`,
        d.score != null && d.score < d.loan_score && `放款时信用分 ${d.score}，低于 ${d.loan_score}`,
      ].filter(Boolean);
      return parts.length ? parts.join('；') : `贷款 ${amount(d.amount)}`;
    }
    case 'loan_overdue': return `第 ${d.seq} 期逾期，剩余本金 ${amount(d.remaining)}`;
    case 'withdraw_large': return `取款 ${amount(d.amount)}，超过单笔限额 ${amount(d.limit)} 的 ${d.ratio}%`;
    case 'term_early': return `提前支取本金 ${amount(d.principal)} 的定期，取出 ${amount(d.amount)}`;
    case 'reversal_many': return `当天第 ${d.count} 笔冲正，原流水 ${d.original_no}`;
    case 'ops_frequent': return `${d.minutes} 分钟内在柜台办理 ${d.count} 笔`;
    case 'setting_change': {
      const items = settingItems(String(d.key), d.before, d.after);
      return isGroup(d) ? `改了 ${items.length} 项` : changeText(String(d.key), items);
    }
    case 'credit_adjust': return `${d.delta > 0 ? '加' : '减'} ${Math.abs(d.delta)} 分，调整后 ${d.score} 分`;
    case 'stock_low': return `库存 ${d.stock} 件，安全库存 ${d.safety_stock} 件`;
    case 'cash_unbalanced': return `${d.by === 'review' ? '复核时点的现金' : '下班时柜员点的现金'}${diffAmount(d.diff)}`;
    case 'manual_entry': return `补录${TXN_TYPES[d.type] ?? d.type} ${amount(d.amount)}，发生于 ${clock(d.occurred_at)}`;
    case 'txn_correct': return `编辑流水 ${d.original_no}，改为${TXN_TYPES[d.type] ?? d.type} ${amount(d.amount)}`;
    case 'credit_switch': return `${d.enabled ? '重新开启' : '暂停'}信用分，涉及 ${d.students} 位学生`;
  }
}

// The kinds a teller's business at the counter raises: their line names the teller.
const COUNTER: AlertKind[] = ['loan_large', 'withdraw_large', 'term_early', 'ops_frequent'];
// A row's second line: the time, the 说明, and the teller for a counter business. `timeOnly` under a day's title.
export function alertLine(a: Alert, timeOnly = false) {
  return [clock(a.at, timeOnly), alertText(a), COUNTER.includes(a.kind) && a.staff_name].filter(Boolean).join(' · ');
}
// Who handled it, when, how, and their note: "王老师 12月4日 11:05 终止：学生说明了用途"; empty while open.
export function handledLine(a: Alert) {
  if (a.status === 'open' || !a.handled_at) return '';
  return `${handledBy(a)}${a.note ? `：${a.note}` : ''}`;
}
// "王老师 12月4日 11:05 终止", the 处理 row of the alert's page.
export const handledBy = (a: Alert) => `${a.handler_name ?? ''} ${clock(a.handled_at!)} ${a.status === 'terminated' ? '终止' : '查看'}`.trim();

type Row = [string, string, boolean?];
// The rows of an alert's page after 时间, 种类, 状态 and its object: the 说明 taken apart (the third value draws it in danger).
export function alertRows(a: Alert): Row[] {
  const d = a.detail;
  const teller: Row[] = a.staff_name ? [['经办柜员', a.staff_name]] : [];
  const by = (label: string): Row[] => (a.staff_name ? [[label, a.staff_name]] : []);
  const reason: Row[] = d.reason ? [['原因', String(d.reason)]] : [];
  switch (a.kind) {
    case 'loan_large': return [
      ['贷款编号', d.loan_no], ['贷款金额', amount(d.amount)], ...(d.score != null ? [['放款时信用分', `${d.score} 分`] as Row] : []),
      ['提醒线', `超过 ${amount(d.loan_amount)}，或信用分低于 ${d.loan_score}`], ...teller,
    ];
    case 'loan_overdue': return [['贷款编号', d.loan_no], ['逾期的一期', `第 ${d.seq} 期`], ['剩余本金', amount(d.remaining)]];
    case 'withdraw_large': return [['流水号', d.txn_no], ['取款', amount(d.amount)], ['单笔限额', amount(d.limit)], ['提醒线', `${d.ratio}%`], ...teller];
    case 'term_early': return [['流水号', d.txn_no], ['定期本金', amount(d.principal)], ['取出', amount(d.amount)], ...teller];
    case 'reversal_many': return [['冲正流水', d.txn_no], ['原流水', d.original_no], ['当天第几笔', `第 ${d.count} 笔`]];
    case 'ops_frequent': return [['流水号', d.txn_no], ['办理', `${d.minutes} 分钟内 ${d.count} 笔`], ...teller];
    case 'setting_change': {
      const items = settingItems(String(d.key), d.before, d.after);
      const single = items.length === 1 && items[0][0] === settingName(String(d.key));
      return [
        ...(single ? [['修改前', items[0][1]], ['修改后', items[0][2]]] as Row[] : items.map(([name, was, now]): Row => [name, `${was} → ${now}`])),
        ...by('修改人'),
      ];
    }
    case 'credit_adjust': return [['变动', `${d.delta > 0 ? '加' : '减'} ${Math.abs(d.delta)} 分`], ['调整后', `${d.score} 分`], ...reason, ...by('调整人')];
    case 'stock_low': return [['库存', `${d.stock} 件`], ['安全库存', `${d.safety_stock} 件`]];
    case 'cash_unbalanced': return [
      ['发现于', d.by === 'review' ? '复核' : '柜员下班'], ['差额', diffAmount(d.diff), true], ['各面额', diffFaces(d.diff)],
      ...(d.note ? [['当时写的原因', String(d.note)] as Row] : []),
    ];
    case 'manual_entry': return [
      ['流水号', d.txn_no], ['类型', TXN_TYPES[d.type] ?? d.type], ['金额', amount(d.amount)], ['发生于', clock(d.occurred_at)], ...reason, ...by('经办人'),
    ];
    case 'txn_correct': return [['原流水', d.original_no], ['新流水', d.txn_no], ['改为', `${TXN_TYPES[d.type] ?? d.type} ${amount(d.amount)}`], ...reason, ...by('经办人')];
    case 'credit_switch': return [['操作', d.enabled ? '重新开启信用分' : '暂停信用分'], ['涉及', `${d.students} 位学生`], ...reason, ...by('经办人')];
  }
}

// The page an alert's event is on: the loan, or the duty's 复核 page.
export function alertLink(a: Alert): { href: string; label: string } | null {
  const id = a.target.split(':')[1];
  if (a.kind === 'loan_large' || a.kind === 'loan_overdue') return { href: `/admin/loans/${id}`, label: '查看贷款' };
  if (a.kind === 'cash_unbalanced') return { href: `/admin/cash/${id}`, label: '查看这次上班' };
  return null;
}

// What 终止 does (design system RiskAlerts 确认终止): the 处理 card's caption, and the ConfirmSheet's title, text with the
// reason `note`, and for a group of values each one put back. Null for the kinds only marked 已查看.
export function termination(a: Alert, note = '') {
  const d = a.detail;
  const who = alertObject(a);
  switch (a.kind) {
    case 'loan_large': case 'loan_overdue': {
      const text = '剩余本金和已产生的利息立即全部到期：先从活期扣，不够的部分算逾期。';
      return { caption: `终止会让这笔贷款提前到期。${text}`, title: `终止${who}的贷款？`, text };
    }
    case 'withdraw_large': {
      const effect = `${who}的活期加回 ${amount(d.amount)}，这笔现金不计入任何一次上班。`;
      return { caption: `终止会冲正这笔取款：${effect}`, title: `冲正${who}这笔 ${amount(d.amount)} 的取款？`, text: `${effect}冲正原因记为“其他：${note}”。` };
    }
    case 'term_early': {
      const text = `定期恢复为未到期，取出的 ${amount(d.amount)} 从活期扣回；活期不够时不能冲正。`;
      return { caption: `终止会冲正这笔提前支取：${text}`, title: `冲正${who}这笔提前支取？`, text };
    }
    case 'reversal_many': case 'ops_frequent': {
      const teller = a.staff_name ?? '柜员';
      return {
        caption: `终止会让${teller}强制下班：结束这笔业务时的那次上班，要重新上班才能继续办理。`,
        title: `让${teller}强制下班？`,
        text: `结束${teller}这笔业务时的那次上班，柜台马上不能再办理业务，要重新上班才能继续。这次上班没有柜员实点，由财务点数复核。`,
      };
    }
    case 'setting_change': {
      const items = settingItems(String(d.key), d.before, d.after);
      const back = isGroup(d) ? `${who}恢复为修改前的 ${items.length} 项值` : `${who}恢复为 ${backText(String(d.key), items)}`;
      return {
        caption: `终止会把${back}，从下一次计算起生效。`, title: `把${who}恢复为修改前的值？`, text: `${back}，从下一次计算起生效。`,
        list: isGroup(d) ? items.map(([name, was, now]): [string, string] => [name, `${now} → ${was}`]) : undefined,
      };
    }
    case 'credit_adjust': {
      const back = `${who}的信用分${d.delta > 0 ? '减' : '加'} ${Math.abs(d.delta)} 分`;
      return {
        caption: `终止会再记一条相反的变动：${back}。`, title: '撤回这次信用分调整？',
        text: `再记一条相反的变动：${back}，原因记为“风险提醒终止：${note}”。`,
      };
    }
    default: return null;
  }
}

// The 风险提醒 page, or one alert's page, with the list's filters (tab, from, to, kinds) kept in the address.
export function alertsHref(params: Record<string, string | undefined>, id?: number) {
  const query = new URLSearchParams(Object.entries(params).filter((p): p is [string, string] => !!p[1])).toString();
  return `/admin/alerts${id ? `/${id}` : ''}${query ? `?${query}` : ''}`;
}
