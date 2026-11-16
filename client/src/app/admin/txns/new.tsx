import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Avatar, CashCounter, ConfirmSheet, DatePicker, Desk, FormLoading, Icon, Notice, ProductPicker, Summary, TilesLoading, TimePicker, today, type Product,
} from '@/components';
import { LEDGER, type LedgerRow } from '@/components/Ledger';
import { cashTotal, type Counts } from '@/lib/cash';
import { classOf, newId, useSettings } from '@/lib/counter';
import { AppError, explain } from '@/lib/errors';
import { formatAmount } from '@/lib/format';
import {
  ADJUST_MAX, atText, balanceMove, dayAndTime, doneText, ENTRY_NAME, ENTRY_TYPES, entryAmount, entryArgs, entryDelta, entryProblem, entryQuestion,
  occurredAt, rangeHint, REASON_MAX, sameEntry, type Entry, type EntryType,
} from '@/lib/manual';
import { call } from '@/lib/rpc';
import { searchRoster } from '@/lib/search';
import { useMe } from '@/lib/session';
import { STATUS, useStudents, type AdminStudent } from '@/lib/students';
import { supabase } from '@/lib/supabase';

const REASONS = ['金额录错', '学号录错', '业务选错', '其他'];
type Problem = { title: string; text: string } | null;
type Result = { txn_no: string; interest: { centi: number }[] };

// 补录流水 and 编辑 HT… (PHASE-2.md §10.11, design system ManualEntry), the bank admin's only: ?edit=<id> edits that
// transaction, otherwise a business is entered at the time it happened. One form either way; a sheet checks it once
// more, and a refusal stays in the sheet. Done, it goes back to 流水 with the new transaction open.
export default function ManualEntryPage() {
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const me = useMe().data!;
  const original = useQuery({
    queryKey: ['admin-txn', edit],
    enabled: !!edit,
    queryFn: async () => {
      const { data, error } = await supabase.from('txns').select(LEDGER).eq('id', edit!).single();
      if (error) throw error;
      return data as unknown as LedgerRow;
    },
  });
  if (!me.roles.includes('teacher')) return <Redirect href="/admin/txns" />;
  if (!edit) return <EntryForm />;
  const o = original.data;
  return (
    <Desk title={o ? `编辑 ${o.txn_no}` : '编辑流水'} back={() => router.navigate('/admin/txns')}>
      {original.error ? <Notice tone="danger" title="暂时无法读取这笔流水">请检查网络后再试一次。</Notice>
        : !o ? <FormLoading />
        : o.status !== 'normal' || !ENTRY_NAME[o.type as EntryType] ? <Notice tone="danger" title="不能编辑这笔流水">这笔流水已经冲正或编辑过，不能再编辑。</Notice>
        : <EntryForm original={o} />}
    </Desk>
  );
}

// What the original was, in the form's terms; a 取款 without its notes, as the form starts with them closed.
function entryOf(t: LedgerRow): Entry {
  const type = t.type as EntryType;
  return {
    type, amount: type === 'adjust' ? t.balance_delta : t.amount, payment: type === 'purchase' ? t.payment : null,
    denominations: type === 'deposit' || (type === 'purchase' && t.payment === 'cash') ? t.denominations : null,
    items: type === 'purchase' ? (t.txn_items ?? []).map((i) => ({ product_id: i.product_id!, qty: i.qty })) : null,
  };
}

function EntryForm({ original }: { original?: LedgerRow }) {
  const queryClient = useQueryClient();
  const { denominations: faces } = useSettings();
  const students = useStudents();
  const before = original && entryOf(original);
  const init = useMemo(() => dayAndTime(original?.created_at ?? new Date().toISOString()), [original]);
  const [id] = useState(newId);
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState<string | null>(original?.student_no ?? null);
  const [type, setType] = useState<EntryType>(before?.type ?? 'deposit');
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [counts, setCounts] = useState<Counts>(before?.type === 'deposit' ? before.denominations ?? {} : {});
  const [withdrawText, setWithdrawText] = useState(before?.type === 'withdraw' ? String(before.amount) : '');
  const [paidOut, setPaidOut] = useState<Counts | null>(null);
  const [cart, setCart] = useState<Record<string, number>>(Object.fromEntries((before?.items ?? []).map((i) => [i.product_id, i.qty])));
  const [payment, setPayment] = useState<'account' | 'cash'>(before?.payment ?? 'account');
  const [received, setReceived] = useState<Counts>(before?.type === 'purchase' ? before.denominations ?? {} : {});
  const [down, setDown] = useState(before?.type === 'adjust' && before.amount < 0);
  const [adjustText, setAdjustText] = useState(before?.type === 'adjust' ? String(Math.abs(before.amount)) : '');
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Problem>(null);

  // Every product, as a 补录 may be of one taken off the shelf since; picked ones stay listed. An edited 兑换's own
  // goods come back to stock when it is reversed.
  const products = useQuery({
    queryKey: ['manual-products'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('id,name,price,stock,image_path,listed').order('category').order('name');
      if (error) throw error;
      return data as (Product & { listed: boolean })[];
    },
  });
  const goods = (products.data ?? []).map((p) => ({ ...p, stock: p.stock + (before?.items?.find((i) => i.product_id === p.id)?.qty ?? 0) }))
    .filter((p) => p.listed || cart[p.id]);

  const found = useMemo(() => (text.trim() ? searchRoster(students.data?.index ?? [], text, 8) : []), [students.data, text]);
  const student = students.data?.rows.find((s) => s.student_no === chosen) ?? null;
  const first = original ? students.data?.rows.find((s) => s.student_no === original.student_no) ?? null : null;

  const due = goods.reduce((s, p) => s + p.price * (cart[p.id] ?? 0), 0);
  const entry: Entry =
    type === 'deposit' ? { type, amount: cashTotal(counts), payment: null, denominations: counts, items: null }
    : type === 'withdraw' ? { type, amount: Number(withdrawText) || 0, payment: null, denominations: paidOut, items: null }
    : type === 'purchase' ? { type, amount: due, payment, denominations: payment === 'cash' ? received : null,
        items: Object.entries(cart).filter(([, n]) => n > 0).map(([product_id, qty]) => ({ product_id, qty })) }
    : { type, amount: (down ? -1 : 1) * (Number(adjustText) || 0), payment: null, denominations: null, items: null };
  const problem = entryProblem(entry);
  const fullReason = original ? (reason === '其他' ? `其他：${other.trim()}` : reason) : reason.trim();
  const reasonOk = original ? !!reason && (reason !== '其他' || !!other.trim()) : !!reason.trim();
  const same = !!original && !!before && sameEntry({ ...entry, student_no: chosen ?? '' }, { ...before, student_no: original.student_no });
  const ready = !!student && !problem && reasonOk && !!date && !!time && !same;
  const at = occurredAt(date, time);
  const start = student?.opened_at ?? null;
  const balance = (s: AdminStudent | null) => s?.accounts?.balance ?? 0;

  async function submit() {
    if (busy || !student) return; // the same id is idempotent on the server too
    setBusy(true);
    setError(null);
    const args = entryArgs(entry);
    try {
      const result = original
        ? (await call<{ txn: Result }>('correct_txn', {
          p_id: id, p_original_id: original.id, p_reason: fullReason,
          p_new: { student_no: student.student_no, type, ...args },
        })).txn
        : await call<Result>('manual_entry', {
          p_id: id, p_student_no: student.student_no, p_type: type, p_occurred_at: at, p_reason: fullReason,
          p_amount: args.amount, p_payment: args.payment, p_denominations: args.denominations, p_items: args.items,
        });
      queryClient.invalidateQueries();
      router.replace({ pathname: '/admin/txns', params: { no: result.txn_no, done: doneText(original ? '编辑' : '补录', result.interest) } });
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('');
      // The range starts at the student's opening; read it again so the hint shows the server's.
      if (err.code === 'OCCURRED_OUT_OF_RANGE') queryClient.invalidateQueries({ queryKey: ['admin-students'] });
      setError(explain(err.code, { ...err.detail, edit: !!original }));
      setBusy(false);
    }
  }

  const name = (s: AdminStudent | null) => s?.name ?? '';
  const form = (
    <form className="dc-form dc-enter" noValidate onSubmit={(e) => { e.preventDefault(); if (ready) { setError(null); setConfirming(true); } }}>
      {original && <p className="dc-caption">原流水冲正，按改好的内容记一笔新流水，时间不变。</p>}
      {student ? (
        <div className="dc-person">
          <Avatar role="student" lg className="dc-person-avatar" />
          <div className="dc-person-main">
            <div className="dc-person-name">
              {student.name}
              {student.status !== 'normal' && <> <span className="dc-tag dc-tag-danger"><Icon name="warning" />{STATUS[student.status]}</span></>}
            </div>
            <div className="dc-person-meta"><span>{classOf(student)}</span> · <span>学号 {student.student_no}</span></div>
          </div>
          <div className="dc-person-side">{formatAmount(balance(student))}<small>活期余额 HTB</small></div>
          <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={() => setChosen(null)}>换一位</button>
        </div>
      ) : (
        <section className="dc-stack" role="search" aria-label="查找学生">
          <label className="dc-search">
            <Icon name="query" />
            <input type="search" aria-label="搜索学生" placeholder="输入姓名、拼音、班级或学号" autoComplete="off" enterKeyHint="search"
              value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (found.length) { setChosen(found[0].student_no); setText(''); } } }} />
            {text && <button className="dc-search-clear" type="button" aria-label="清除" onClick={() => setText('')}><Icon name="close" /></button>}
          </label>
          {found.length > 0 && (
            <ul className="dc-list dc-filter-found" aria-label="搜索建议">
              {found.map((s) => (
                <li key={s.student_no}>
                  <a className="dc-list-link" href="#" onClick={(e) => { e.preventDefault(); setChosen(s.student_no); setText(''); }}>
                    <span className="dc-list-icon"><Icon name="me" /></span>
                    <span>{s.name}<small className="dc-top-sub">{classOf(s)} · 学号 {s.student_no}</small></span>
                    <Icon name="next" />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {text.trim() && students.data && !found.length && <p className="dc-top-sub">没有找到「{text.trim()}」。</p>}
          {students.isError && <Notice tone="danger" title="暂时无法读取学生名单">请检查网络后刷新页面。</Notice>}
        </section>
      )}

      <fieldset className="dc-seg" aria-label="类型">
        {ENTRY_TYPES.map(([key, label]) => (
          <label key={key}><input type="radio" name="entry-type" checked={type === key} onChange={() => setType(key)} /><span>{label}</span></label>
        ))}
      </fieldset>

      <section className="dc-stack">
        <DatePicker label="日期" value={date} onChange={setDate} min={start ? dayAndTime(start).date : undefined} max={today()}
          rule={rangeHint(start)} locked={original ? '编辑时间固定为原流水的时间' : undefined} />
        <TimePicker label="时刻" value={time} onChange={setTime} rule="精确到分" locked={!!original} />
        {!original && <p className="dc-field-hint">{rangeHint(start)}</p>}
      </section>

      {type === 'deposit' && (
        <>
          <CashCounter faces={faces} counts={counts} onChange={setCounts} kind="dc-kind-save" />
          <p className="dc-caption">合计 {formatAmount(entry.amount)} HTB</p>
        </>
      )}
      {type === 'withdraw' && (
        <>
          <label className="dc-field">
            <span className="dc-field-label"><Icon name="withdraw" />取款金额</span>
            <span className="dc-input-wrap">
              <input className="dc-input" inputMode="numeric" value={withdrawText} placeholder="请输入金额"
                onChange={(e) => setWithdrawText(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              <span className="dc-input-unit">HTB</span>
            </span>
          </label>
          {paidOut ? (
            <>
              <CashCounter faces={faces} counts={paidOut} onChange={setPaidOut} kind="dc-kind-withdraw" />
              <p className="dc-caption">面额合计 {formatAmount(cashTotal(paidOut))} HTB{problem && entry.amount ? `，${problem}` : ''}</p>
            </>
          ) : (
            <button className="dc-btn dc-btn-ghost dc-btn-sm dc-btn-inline" type="button" onClick={() => setPaidOut({})}>录入面额</button>
          )}
        </>
      )}
      {type === 'purchase' && (
        <>
          {products.error ? <Notice tone="danger" title="暂时无法读取商品">请检查网络后重试。</Notice>
            : products.isPending ? <TilesLoading /> : <ProductPicker products={goods} cart={cart} onChange={setCart} />}
          <fieldset className="dc-seg" aria-label="付款方式">
            {([['account', '账户'], ['cash', '现金']] as const).map(([key, label]) => (
              <label key={key}><input type="radio" name="entry-payment" checked={payment === key} onChange={() => setPayment(key)} /><span>{label}</span></label>
            ))}
          </fieldset>
          {payment === 'cash' && (
            <>
              <CashCounter faces={faces} counts={received} onChange={setReceived} kind="dc-kind-exchange" />
              <p className="dc-caption">
                应付 {formatAmount(due)} HTB，收到 {formatAmount(cashTotal(received))} HTB，找零 {formatAmount(Math.max(cashTotal(received) - due, 0))} HTB
              </p>
            </>
          )}
        </>
      )}
      {type === 'adjust' && (
        <>
          <fieldset className="dc-seg" aria-label="调账方向">
            {([[false, '增加'], [true, '减少']] as const).map(([key, label]) => (
              <label key={label}><input type="radio" name="entry-sign" checked={down === key} onChange={() => setDown(key)} /><span>{label}</span></label>
            ))}
          </fieldset>
          <label className="dc-field">
            <span className="dc-field-label"><Icon name="transfer" />调账金额</span>
            <span className="dc-input-wrap">
              <input className="dc-input" inputMode="numeric" value={adjustText} placeholder="请输入金额"
                onChange={(e) => setAdjustText(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              <span className="dc-input-unit">HTB</span>
            </span>
            <span className="dc-field-hint">1～{formatAmount(ADJUST_MAX)} HTB，只改活期，不涉及现金</span>
          </label>
        </>
      )}

      {original ? (
        <>
          <fieldset className="dc-check-group">
            <legend>原因</legend>
            {REASONS.map((r) => (
              <label key={r} className="dc-check">
                <input type="radio" name="correct-reason" checked={reason === r} onChange={() => setReason(r)} />
                <span className="dc-radio-dot" />{r}
              </label>
            ))}
          </fieldset>
          {reason === '其他' && (
            <label className="dc-field">
              <span className="dc-field-label"><Icon name="help" />说明</span>
              <span className="dc-input-wrap">
                <input className="dc-input" value={other} maxLength={60} placeholder="写清楚编辑的原因" onChange={(e) => setOther(e.target.value)} />
              </span>
            </label>
          )}
        </>
      ) : (
        <label className="dc-field">
          <span className="dc-field-label"><Icon name="help" />原因</span>
          <span className="dc-input-wrap dc-input-area">
            <textarea className="dc-input" rows={3} maxLength={REASON_MAX} value={reason} placeholder="写清为什么补录，例如：系统故障，当天未记"
              onChange={(e) => setReason(e.target.value)} />
          </span>
          <span className="dc-field-hint">必填，最多 {REASON_MAX} 字</span>
        </label>
      )}

      <div className="dc-actions">
        <button className="dc-btn dc-btn-primary" type="submit" disabled={!ready}>{original ? '编辑' : '补录'}</button>
        <div className="dc-actions-total">
          <span>{original ? `改为${ENTRY_NAME[type]}` : type === 'adjust' ? '调账' : `补录${ENTRY_NAME[type]}`}<small>记在 {atText(at)}</small></span>
          <b>{type === 'adjust' && entry.amount ? `${entry.amount < 0 ? '−' : '+'}${formatAmount(entry.amount)}` : formatAmount(entry.amount)}<small>HTB</small></b>
        </div>
      </div>
    </form>
  );

  const delta = entryDelta(entry);
  const oldDelta = original?.balance_delta ?? 0;
  const sheet = confirming && student && (original && before ? (
    <ConfirmSheet title={`编辑 ${original.txn_no}？`} confirm={busy ? '正在编辑' : '确认编辑'} busy={busy} onConfirm={submit}
      onClose={() => { setConfirming(false); setError(null); }}>
      <div className="dc-table-scroll">
        <table className="dc-table" aria-label="原来与改为">
          <thead><tr><th scope="col">项目</th><th scope="col">原来</th><th scope="col">改为</th></tr></thead>
          <tbody>
            {([['学生', name(first) || original.student_no, student.name], ['类型', ENTRY_NAME[before.type], ENTRY_NAME[type]],
              ['金额', entryAmount(before), entryAmount(entry)]] as const).map(([k, a, b]) => (
              <tr key={k}><td>{k}</td><td>{a}</td><td>{a === b ? b : <b>{b}</b>}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <Summary rows={student.student_no === original.student_no
        ? [[`${student.name} 活期`, balanceMove(balance(student), delta - oldDelta)]]
        : [[`${name(first)} 活期`, balanceMove(balance(first), -oldDelta)], [`${student.name} 活期`, balanceMove(balance(student), delta)]]} />
      <p className="dc-caption">原流水冲正，按改好的内容记一笔新流水，两笔都记在 {atText(original.created_at)}，利息随之更正。</p>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
    </ConfirmSheet>
  ) : (
    <ConfirmSheet title={entryQuestion(student.name, entry)} confirm={busy ? '正在补录' : '确认补录'} busy={busy} onConfirm={submit}
      onClose={() => { setConfirming(false); setError(null); }}>
      <Summary rows={[
        ['学生', `${student.name} · ${student.student_no}`], ['类型', ENTRY_NAME[type]], ['金额', entryAmount(entry)], ['原始时间', atText(at)],
        ['活期余额', balanceMove(balance(student), delta)],
      ]} />
      <p className="dc-caption">
        记在 {atText(at)}，之后已经算过的活期利息随之更正，差额在下次结息时入账。{(type === 'purchase' ? payment === 'cash' : type !== 'adjust') && '不计入任何柜员的上班现金。'}
      </p>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
    </ConfirmSheet>
  ));

  const body = <>{students.isPending ? <FormLoading /> : form}{sheet}</>;
  return original ? body : <Desk title="补录流水" back={() => router.navigate('/admin/txns')}>{body}</Desk>;
}
