import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { cashTotal, describeCash, makeChange, nonEmpty, type Counts } from '@/lib/cash';
import {
  buyWealth, classOf, deposit, loanPreview, loanQuote, newId, openLoan, openTermDeposit, purchase, redeemWealth, repayLoan, termQuote, useSettings, wealthQuote,
  withdraw, withdrawTermEarly,
  type Student, type TxnResult,
} from '@/lib/counter';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatCenti, formatRate, formatSigned } from '@/lib/format';
import { call } from '@/lib/rpc';
import { offlineQueue } from '@/lib/offline-queue';
import { useOnline } from '@/lib/online';
import { useBump, useNewRows } from '@/lib/motion';
import { useStaleRefusal } from '@/lib/duty';
import {
  about, amountHint as loanAmountHint, interestText, lastDue, overdueText, penaltyRate, planText, rateText, repayProblem, repaySplit, termTooShort,
  type LoanDetail, type LoanPlan, type LoanQuote,
} from '@/lib/loans';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { monthDay } from '@/lib/term';
import { amountHint, backCenti, type TermDeposit } from '@/lib/term-deposits';
import { toTxn, type TxnRow } from '@/lib/txns';
import { amountHint as wealthHint, bounds, gain, plainPct, plClass, signedPct, tierLabel, type WealthHolding } from '@/lib/wealth';
import { CashCounter, QtySum, Summary } from './Counter';
import { FilterBar, filtered, NO_FILTER, wrongTimes, type Filter } from './Filter';
import { Stats, Table } from './Report';
import { CreditGauge, useGaugeCurve } from './Credit';
import { LOAN_TAGS, PeriodList, useLoanSettings } from './Loan';
import { outside, Stepper } from './Stepper';
import { ConfirmSheet } from './Sheet';
import { TxnListLoading } from './Account';
import { today } from './DatePicker';
import { TermList } from './TermDeposit';
import { WealthList } from './Invest';
import { Toast } from './Toast';
import { KvLoading, TilesLoading } from './Skeleton';
import { Icon, Notice } from './ui';

// The counter's businesses for one student (PHASE-1.md §7.5, design system CounterServicePage). Each panel is the
// entry on the left and the 办理单 on the right: the businesses already done in this visit, the one being entered,
// and the balance after it. A deposit is done at once with the main button; a withdrawal or an exchange is checked
// once more in a sheet first, since its notes or goods leave the counter. A mistake is put right with 冲正 on its
// line in the 办理单. A finished business goes to onDone and the panel starts again empty;
// onEnd ends the visit. `amount` is the change to the account (null when it is untouched: a cash exchange, an
// offline deposit's balance); `txnId` is null when the line has no 冲正 here: an offline deposit until it is uploaded,
// a 提前支取 or a 理财赎回. `termId` ties a 开定期 to its 提前支取 in the same visit, after which the 开定期 has no 冲正 either, and
// `wealthId` a 买理财 to its 赎回 the same way; `loanId`
// ties a 贷款 to its 还款, and only the latest of them has 冲正. `type` is the transaction's, for the reason a 冲正 is refused.
export type Served = {
  label: string; detail: string; amount: number | null; txnNo: string | null; txnId: string | null; reversed?: boolean; termId?: string;
  loanId?: string; wealthId?: string; type?: string;
};
type Props = { student: Student; served: Served[]; onDone: (s: Served) => void; onEnd: () => void; onReverse: (s: Served) => void };
type Problem = { title: string; text: string } | null;
type Current = { label: string; detail: string; amount: string } | null;

const failure = (e: unknown) => {
  const err = e instanceof AppError ? e : new AppError('');
  return { err, problem: explain(err.code, err.detail) };
};

export const servedAmount = (s: Served) => (s.amount === null ? '现金' : formatSigned(s.amount));

// 办理单: what this visit has done (newest last, popping in, each with its 冲正), the business being entered, the
// balance after it, and the one way to end the visit.
function Receipt({ served, current, after, onEnd, onReverse }: {
  served: Served[]; current: Current; after: number | string | null; onEnd: () => void; onReverse: (s: Served) => void;
}) {
  return (
    <aside className="dc-card is-sticky" aria-label="办理单">
      <h2 className="heading has-gap">办理单</h2>
      <dl className="dc-kv" aria-live="polite">
        {served.map((s, i) => (
          <div key={i} className="dc-pop" style={s.reversed ? { opacity: 0.6 } : undefined}>
            <dt>
              {s.label}{s.reversed && '（已冲正）'}
              <small className="dc-top-sub">{[s.detail, s.txnNo ?? '联网后入账'].filter(Boolean).join(' · ')}</small>
              {s.txnId && !s.reversed && !served.some((x) => x !== s && ((s.termId && x.termId === s.termId) || (s.wealthId && x.wealthId === s.wealthId)))
                && !served.slice(i + 1).some((x) => s.loanId && x.loanId === s.loanId && x.type === 'repay' && !x.reversed) && (
                <button className="dc-btn dc-btn-ghost dc-btn-sm dc-btn-inline" type="button" style={{ marginTop: 'var(--space-1)' }}
                  aria-label={`冲正${s.label}`} onClick={() => onReverse(s)}><Icon name="transfer" />冲正</button>
              )}
            </dt>
            <dd>{servedAmount(s)}</dd>
          </div>
        ))}
        {current && <div><dt>{current.label}（正在办理）<small className="dc-top-sub">{current.detail}</small></dt><dd>{current.amount}</dd></div>}
        {current && after !== null && <div><dt>办理后余额</dt><dd>{typeof after === 'number' ? `${formatAmount(after)} HTB` : after}</dd></div>}
        {!served.length && !current && <div><dt>还没有办理业务</dt><dd /></div>}
      </dl>
      {served.length > 0 && (
        <button className="dc-btn dc-btn-secondary dc-btn-block" type="button" style={{ marginTop: 'var(--space-4)' }} onClick={onEnd}>
          结束办理 {served.filter((s) => !s.reversed).length} 笔
        </button>
      )}
    </aside>
  );
}

// The bar under every panel: the business's main button and its total.
function Bar({ busy, ready, label, onClick, totalLabel, total, note }: {
  busy: boolean; ready: boolean; label: string; onClick: () => void; totalLabel: string; total: number; note?: ReactNode;
}) {
  const totalRef = useBump<HTMLElement>(total);
  return (
    <div className="dc-actions">
      <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button" disabled={busy || !ready} onClick={onClick}>
        {label}
      </button>
      <div className="dc-actions-total">
        <span>{totalLabel}{note && <small>{note}</small>}</span>
        <b ref={totalRef}>{formatAmount(total)}<small>HTB</small></b>
      </div>
    </div>
  );
}

// 存款: count the notes by face value. Offline, or when the call gets no answer, the deposit is registered on this
// device and uploaded later under the same id (§7.7).
export function DepositPanel({ student, served, onDone, onEnd, onReverse }: Props) {
  const me = useMe().data!;
  const online = useOnline();
  const { denominations } = useSettings();
  const queryClient = useQueryClient();
  const stale = useStaleRefusal();
  const [counts, setCounts] = useState<Counts>({});
  const [id, setId] = useState(newId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Problem>(null);
  const amount = cashTotal(counts);
  // Offline the deposit is only registered, so there is no balance after it to show yet.
  const after = !online || student.balance === null ? null : student.balance + amount;

  function finish(result: TxnResult | null) {
    onDone(result
      ? { label: '存款', detail: describeCash(counts), amount, txnNo: result.txn_no, txnId: result.id }
      : { label: '存款（离线登记）', detail: describeCash(counts), amount, txnNo: null, txnId: null });
    setCounts({});
    setId(newId());
  }

  async function submit() {
    if (busy) return; // the same id is idempotent on the server too
    setBusy(true);
    setError(null);
    const queue = () => offlineQueue.add({
      id, student_no: student.student_no, name: student.name, class: classOf(student), cash: nonEmpty(counts), amount,
      operator_id: me.profile.id, operator_name: me.profile.display_name, created_at: new Date().toISOString(),
    }).then(() => queryClient.invalidateQueries({ queryKey: ['offline-deposits'] }));
    try {
      if (!online) {
        await queue();
        finish(null);
      } else {
        finish(await deposit(id, student.student_no, nonEmpty(counts)));
      }
    } catch (e) {
      stale(e);
      const { err, problem } = failure(e);
      if (err.code === 'NETWORK') {
        await queue();
        finish(null);
      } else {
        setError(problem);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="dc-split">
        <section className="dc-stack">
          <h2 className="heading">按面额录入张数</h2>
          <CashCounter faces={denominations} counts={counts} onChange={setCounts} kind="dc-kind-save" />
        </section>
        <Receipt served={served} onEnd={onEnd} onReverse={onReverse} after={online ? after : '待上传'}
          current={amount > 0 ? { label: '存款', detail: describeCash(counts), amount: formatSigned(amount) } : null} />
      </div>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <Bar busy={busy} ready={amount > 0} onClick={submit}
        label={busy ? '正在存款' : amount > 0 ? `确认存款 ${formatAmount(amount)} HTB` : '请录入张数'}
        totalLabel="合计存入" total={amount} note={after !== null && `存入后余额 ${formatAmount(after)} HTB`} />
    </>
  );
}

// 取款: the amount, the notes to pay out, and what is still allowed today.
export function WithdrawPanel({ student, served, onDone, onEnd, onReverse }: Props) {
  const settings = useSettings();
  const stale = useStaleRefusal();
  const [text, setText] = useState('');
  const [id, setId] = useState(newId);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<Problem>(null);
  const amount = Number(text) || 0;

  const balance = student.balance ?? 0;
  const single = settings.single[student.division];
  const daily = settings.daily[student.division];
  const todayLeft = daily === undefined ? undefined : Math.max(daily - (student.withdrawn_today ?? 0), 0);
  // Checked again by withdraw(); shown here so the teller sees the reason before confirming.
  const problem =
    !amount ? null
    : amount > balance ? `余额不足：可用余额 ${formatAmount(balance)} HTB，还差 ${formatAmount(amount - balance)} HTB`
    : single !== undefined && amount > single ? `超过单笔取款限额 ${formatAmount(single)} HTB`
    : todayLeft !== undefined && amount > todayLeft ? `超过今日取款限额：今日还可取款 ${formatAmount(todayLeft)} HTB`
    : null;
  const payout = describeCash(makeChange(amount, settings.denominations));

  async function submit() {
    if (busy) return; // the same id is idempotent on the server too
    setBusy(true);
    setError(null);
    try {
      const result = await withdraw(id, student.student_no, amount);
      onDone({ label: '取款', detail: `配钞 ${describeCash(result.denominations ?? {})}`, amount: -amount, txnNo: result.txn_no, txnId: result.id });
      setText('');
      setId(newId());
    } catch (e) {
      stale(e);
      setError(failure(e).problem);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <div className="dc-split">
        <section className="dc-stack">
          <label className={`dc-field ${problem ? 'is-error' : ''}`}>
            <span className="dc-field-label"><Icon name="withdraw" />取款金额</span>
            <span className="dc-input-wrap">
              <input className="dc-input" inputMode="numeric" autoFocus value={text} placeholder="请输入金额"
                onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              <span className="dc-input-unit">HTB</span>
            </span>
            <span className="dc-field-hint">
              {problem ? <><Icon name="warning" />{problem}</> : amount ? `配钞：${payout}` : `单笔最多 ${single ?? '—'} HTB`}
            </span>
          </label>
        </section>
        <Receipt served={served} onEnd={onEnd} onReverse={onReverse} after={Math.max(balance - amount, 0)}
          current={amount ? { label: '取款', detail: `配钞 ${payout}`, amount: formatSigned(-amount) } : null} />
      </div>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <Bar busy={busy} ready={!!amount && !problem} onClick={() => setConfirming(true)}
        label={busy ? '正在取款' : !amount ? '请输入金额' : problem ? '金额超出可取范围' : `确认取款 ${formatAmount(amount)} HTB`}
        totalLabel="合计取款" total={amount} note={`取款后余额 ${formatAmount(Math.max(balance - amount, 0))} HTB`} />
      {confirming && (
        <ConfirmSheet title={`为${student.name}取款 ${formatAmount(amount)} HTB？`} text="请核对金额，确认后按下面的配钞付给学生。"
          confirm="确认取款" busy={busy} onConfirm={submit} onClose={() => setConfirming(false)}>
          <Summary rows={[
            ['学生', `${student.name} · 学号 ${student.student_no}`], ['取款金额', `${formatAmount(amount)} HTB`], ['配钞', payout],
            ['取款后余额', `${formatAmount(Math.max(balance - amount, 0))} HTB`],
          ]} />
        </ConfirmSheet>
      )}
    </>
  );
}

const INACTIVE: Record<string, string> = { frozen: '账户已冻结', graduated: '账户已毕业' };

// 定期 (PHASE-2.md §10.2, design system TermDeposit): from term_quote, the five lengths with their fixed rates (in term
// and in the holidays alike), the amount out of 活期 with what comes back at maturity, and the student's 定期 with
// 提前支取. 开定期 is checked once more in a sheet; a refusal stays in the sheet. A frozen or graduated account only lists
// its 定期.
export function TermPanel({ student, served, onDone, onEnd, onReverse }: Props) {
  const stale = useStaleRefusal();
  const done = served.length + served.filter((s) => s.reversed).length;
  const quote = useQuery({ queryKey: ['term-quote', student.student_no, done], queryFn: () => termQuote(student.student_no) });
  const [weeks, setWeeks] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [id, setId] = useState(newId);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [early, setEarly] = useState<TermDeposit | null>(null);
  const [error, setError] = useState<Problem>(null);
  const [toast, setToast] = useState<string | null>(null);
  const q = quote.data;
  const now = today();
  const inactive = INACTIVE[student.status];
  const amount = Number(text) || 0;
  const balance = q?.balance ?? student.balance ?? 0;
  const option = q?.options.find((o) => o.weeks === weeks);
  const hint = amountHint(amount, balance, option);
  const open = !!q && !inactive;
  const ready = !!option && !!amount && !hint.error;
  const what = option ? `${option.weeks} 周，${monthDay(option.matures_on)} 到期` : '';

  async function submit() {
    if (busy || !option) return; // the same id is idempotent on the server too
    setBusy(true);
    setError(null);
    try {
      const result = await openTermDeposit(id, student.student_no, amount, option.weeks);
      onDone({ label: '开定期', detail: what, amount: -amount, txnNo: result.txn_no, txnId: result.id, termId: result.term.id });
      setConfirming(false);
      setWeeks(null);
      setText('');
      setId(newId());
    } catch (e) {
      stale(e);
      setError(failure(e).problem);
      quote.refetch();
    } finally {
      setBusy(false);
    }
  }

  async function withdrawEarly() {
    if (busy || !early) return; // sent again, the server returns the same 提前支取
    setBusy(true);
    setError(null);
    try {
      const result = await withdrawTermEarly(early.id);
      const interest = formatCenti(result.term.interest_centi ?? 0);
      onDone({ label: '提前支取', detail: `${early.weeks} 周定期，利息 ${interest} HTB`, amount: result.amount, txnNo: result.txn_no, txnId: null, termId: early.id });
      setEarly(null);
      setToast(`已提前支取，利息 ${interest} HTB`);
    } catch (e) {
      stale(e);
      setError(failure(e).problem);
      quote.refetch();
    } finally {
      setBusy(false);
    }
  }

  const list = q && (
    <>
      <p className="dc-list-title">定期</p>
      {q.deposits.some((d) => d.status !== 'reversed')
        ? <TermList deposits={q.deposits} today={now} onWithdraw={inactive ? undefined : (d) => { setError(null); setEarly(d); }} />
        : <section className="dc-card"><p className="dc-caption">还没有定期。</p></section>}
    </>
  );
  return (
    <>
      {inactive && <Notice title={`${inactive}，不能开定期或提前支取；定期照常到期转回活期。`} />}
      <div className="dc-split">
        <section className="dc-stack">
          {quote.error ? <Notice tone="danger" title="暂时无法读取定期">请检查网络后再试一次。</Notice>
            : !q ? <KvLoading rows={3} />
            : open && (
              <>
                <div className="dc-choices dc-kind-save" role="radiogroup" aria-label="存期">
                  {q.options.map((o) => (
                    <label key={o.weeks} className="dc-choice">
                      <input type="radio" name="weeks" checked={weeks === o.weeks} onChange={() => setWeeks(o.weeks)} />
                      <span><b>{o.weeks} 周</b><small>{monthDay(o.matures_on)} 到期</small><small>{formatRate(o.rate)}/周</small></span>
                    </label>
                  ))}
                </div>
                <label className={`dc-field ${hint.error ? 'is-error' : ''}`}>
                  <span className="dc-field-label"><Icon name="savings" />定期金额</span>
                  <span className="dc-input-wrap">
                    <input className="dc-input" inputMode="numeric" value={text} placeholder="请输入金额"
                      onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                    <span className="dc-input-unit">HTB</span>
                  </span>
                  <span className="dc-field-hint">{hint.error && <Icon name="warning" />}{hint.text}</span>
                </label>
              </>
            )}
          {list}
        </section>
        <Receipt served={served} onEnd={onEnd} onReverse={onReverse} after={Math.max(balance - amount, 0)}
          current={open && option && amount ? { label: '开定期', detail: what, amount: formatSigned(-amount) } : null} />
      </div>
      {error && !confirming && !early && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      {open && (
        <Bar busy={busy} ready={ready} onClick={() => { setError(null); setConfirming(true); }}
          label={busy ? '正在开定期' : '开定期'} totalLabel="存入定期" total={amount}
          note={`办理后余额 ${formatAmount(Math.max(balance - amount, 0))} HTB`} />
      )}
      {confirming && option && (
        <ConfirmSheet title={`给${student.name}开定期 ${formatAmount(amount)} HTB？`} confirm="确认开定期" busy={busy}
          onConfirm={submit} onClose={() => { setConfirming(false); setError(null); }}>
          <Summary rows={[
            ['存期', `${option.weeks} 周`], ['到期日', monthDay(option.matures_on)], ['周利率', `${formatRate(option.rate)}/周（到期前不变）`],
            ['到期拿回', `${backCenti(amount, option)} HTB`], ['活期余额', `${formatAmount(balance)} → ${formatAmount(balance - amount)} HTB`],
          ]} />
          <p className="dc-caption">到期当天结束时自动转回活期。提前支取只按活期算利息。</p>
          {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
        </ConfirmSheet>
      )}
      {early && (
        <ConfirmSheet title={`提前支取这笔定期 ${formatAmount(early.principal)} HTB？`} confirm="提前支取" busy={busy}
          text="不付定期利息，只按活期利率算存入这些天的利息，当天支取没有利息。本金和利息转回活期。"
          onConfirm={withdrawEarly} onClose={() => { setEarly(null); setError(null); }}>
          {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
        </ConfirmSheet>
      )}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

// 理财 (PHASE-2.md §10.10, design system Invest): from wealth_quote, the index's latest trading day with the 10 before
// it, the risk, the five lengths, then each tier with today's rate and its daily bounds, the amount out of 活期, and the
// student's 理财 with 赎回. 买理财 and 赎回 are checked once more in a sheet; a refusal stays in the sheet. A frozen or
// graduated account only lists its 理财.
export function WealthPanel({ student, served, onDone, onEnd, onReverse }: Props) {
  const stale = useStaleRefusal();
  const done = served.length + served.filter((s) => s.reversed).length;
  const quote = useQuery({ queryKey: ['wealth-quote', student.student_no, done], queryFn: () => wealthQuote(student.student_no) });
  const [weeks, setWeeks] = useState<number | null>(null);
  const [tierKey, setTierKey] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [id, setId] = useState(newId);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [redeeming, setRedeeming] = useState<WealthHolding | null>(null);
  const [error, setError] = useState<Problem>(null);
  const [toast, setToast] = useState<string | null>(null);
  const q = quote.data;
  const inactive = INACTIVE[student.status];
  const amount = Number(text) || 0;
  const balance = q?.balance ?? student.balance ?? 0;
  const option = q?.options.find((o) => o.weeks === weeks);
  const tier = option?.tiers.find((t) => t.key === tierKey);
  const hint = wealthHint(amount, balance);
  const open = !!q && !inactive;
  const ready = !!tier && !!amount && !hint.error;
  const what = option && tier ? `${option.weeks} 周 · ${tierLabel(tier)}，${monthDay(option.matures_on)} 到期` : '';
  // LOAN_OUTSTANDING says 买理财 here.
  const refusal = (e: unknown) => {
    const err = e instanceof AppError ? e : new AppError('');
    return explain(err.code, { ...err.detail, wealth: true });
  };

  async function submit() {
    if (busy || !option || !tier) return; // the same id is idempotent on the server too
    setBusy(true);
    setError(null);
    try {
      const result = await buyWealth(id, student.student_no, amount, option.weeks, tier.key);
      onDone({ label: '买理财', detail: what, amount: -amount, txnNo: result.txn_no, txnId: result.id, wealthId: result.holding.id, type: 'wealth_buy' });
      setConfirming(false);
      setWeeks(null);
      setTierKey(null);
      setText('');
      setId(newId());
    } catch (e) {
      stale(e);
      setError(refusal(e));
      quote.refetch();
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    if (busy || !redeeming) return; // sent again, the server returns the same 赎回
    setBusy(true);
    setError(null);
    try {
      const result = await redeemWealth(redeeming.id);
      const g = gain(result.holding.value_centi - 100 * result.holding.principal);
      onDone({ label: '理财赎回', detail: `${redeeming.weeks} 周，${g.text}`, amount: result.amount, txnNo: result.txn_no, txnId: null, wealthId: redeeming.id });
      setRedeeming(null);
      setToast(`已赎回，转回活期 ${formatAmount(result.amount)} HTB`);
    } catch (e) {
      stale(e);
      setError(refusal(e));
      quote.refetch();
    } finally {
      setBusy(false);
    }
  }

  const latest = q?.latest;
  const index = q && (
    <section className="dc-card dc-stack" aria-label="指数涨跌">
      {!latest ? <p className="dc-caption">还没有指数数据。每个交易日收盘后更新。</p> : (
        <>
          <dl className="dc-kv">
            <div><dt>{latest.day === q.today.day ? '今天' : `${monthDay(latest.day)} `}指数涨跌</dt>
              <dd><span className={`dc-pl ${plClass(latest.change)}`}>{signedPct(latest.change)}</span></dd></div>
          </dl>
          <p className="dc-caption">参考 {q.index.name} 指数 · {monthDay(latest.day)} 收盘 · {latest.source_name}</p>
          {q.today.closed === true && <p className="dc-caption">今天休市，只算基础收益。</p>}
          <div className="dc-table-scroll">
            <table className="dc-table" aria-label="最近 10 个交易日">
              <thead><tr><th scope="col">日期</th><th scope="col" className="n">指数涨跌</th></tr></thead>
              <tbody>
                {q.recent.map((d) => (
                  <tr key={d.day}><td>{monthDay(d.day)}</td><td className="n"><span className={`dc-pl ${plClass(d.change)}`}>{signedPct(d.change)}</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
  const list = q && (
    <>
      <p className="dc-list-title">理财</p>
      {q.holdings.some((h) => h.status !== 'reversed')
        ? <WealthList holdings={q.holdings} onRedeem={inactive ? undefined : (h) => { setError(null); setRedeeming(h); }} />
        : <section className="dc-card"><p className="dc-caption">还没有理财。</p></section>}
    </>
  );
  // 平衡 ×2 against the first tier, the plainest: "跟着指数的涨跌是稳健的 2 倍".
  const first = q?.tiers[0];
  const times = tier && first && tier.key !== first.key ? `跟着指数的涨跌是${first.name}的 ${Number((tier.multiplier / first.multiplier).toFixed(2))} 倍，` : '';
  const redeemGain = redeeming && gain(redeeming.value_centi - 100 * redeeming.principal);
  return (
    <>
      {inactive && <Notice title={`${inactive}，不能买理财或赎回；理财照常计收益，到期转回活期。`} />}
      <div className="dc-split">
        <section className="dc-stack">
          {quote.error ? <Notice tone="danger" title="暂时无法读取理财">请检查网络后再试一次。</Notice>
            : !q ? <KvLoading rows={3} />
            : <>
              {index}
              {open && (
                <>
                  <Notice title="理财可能亏损" icon="warning">
                    理财的钱跟着中国股市的一个指数每天涨跌，到期或赎回时拿回的钱可能少于本金。可以随时按当时的价值赎回。
                  </Notice>
                  <div className="dc-choices" role="radiogroup" aria-label="期限">
                    {q.options.map((o) => (
                      <label key={o.weeks} className="dc-choice">
                        <input type="radio" name="wealth-weeks" checked={weeks === o.weeks} onChange={() => setWeeks(o.weeks)} />
                        <span><b>{o.weeks} 周</b><small>{monthDay(o.matures_on)} 到期</small></span>
                      </label>
                    ))}
                  </div>
                  {option && (
                    <div className="dc-stack">
                      <div className="dc-choices" role="radiogroup" aria-label="倍率">
                        {option.tiers.map((t) => (
                          <label key={t.key} className="dc-choice">
                            <input type="radio" name="wealth-tier" checked={tierKey === t.key} onChange={() => setTierKey(t.key)} />
                            <span>
                              <b>{tierLabel(t)}</b>
                              <small>{t.rate === null ? '还没有收益率' : <span className={`dc-pl ${plClass(t.rate)}`}>今天 {signedPct(t.rate)}</span>}</small>
                              {bounds(t).map((b) => <small key={b}>{b}</small>)}
                            </span>
                          </label>
                        ))}
                      </div>
                      <p className="dc-caption">倍率越高，赚得越多，亏得也越多。休市的日子只算基础收益。</p>
                    </div>
                  )}
                  <label className={`dc-field ${hint.error ? 'is-error' : ''}`}>
                    <span className="dc-field-label"><Icon name="invest" />理财金额</span>
                    <span className="dc-input-wrap">
                      <input className="dc-input" inputMode="numeric" value={text} placeholder="请输入金额"
                        onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                      <span className="dc-input-unit">HTB</span>
                    </span>
                    <span className="dc-field-hint">{hint.error && <Icon name="warning" />}{hint.text}</span>
                  </label>
                </>
              )}
              {list}
            </>}
        </section>
        <Receipt served={served} onEnd={onEnd} onReverse={onReverse} after={Math.max(balance - amount, 0)}
          current={open && tier && amount ? { label: '买理财', detail: what, amount: formatSigned(-amount) } : null} />
      </div>
      {error && !confirming && !redeeming && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      {open && (
        <Bar busy={busy} ready={ready} onClick={() => { setError(null); setConfirming(true); }}
          label={busy ? '正在买入' : '买入理财'} totalLabel="买入理财" total={amount}
          note={`办理后余额 ${formatAmount(Math.max(balance - amount, 0))} HTB`} />
      )}
      {confirming && option && tier && (
        <ConfirmSheet title={`给${student.name}买理财 ${formatAmount(amount)} HTB？`} confirm="确认买入" busy={busy}
          onConfirm={submit} onClose={() => { setConfirming(false); setError(null); }}>
          <Summary rows={[
            ['期限', `${option.weeks} 周`], ['倍率', tierLabel(tier)], ['到期日', monthDay(option.matures_on)], ['开始计收益', '明天'],
            ['这一档今天的收益率', tier.rate === null ? '还没有收益率' : signedPct(tier.rate)],
            ['每天范围', `最多赚 ${plainPct(tier.max)}，最多亏 ${plainPct(tier.min)}`],
            ['活期余额', `${formatAmount(balance)} → ${formatAmount(balance - amount)} HTB`],
          ]} />
          <p className="dc-caption is-danger">
            <Icon name="warning" />理财可能亏损，到期拿回的钱可能少于 {formatAmount(amount)} HTB，最多亏光本金。{tierLabel(tier)} {times}一天最多可能亏 {plainPct(tier.min)}。
          </p>
          {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
        </ConfirmSheet>
      )}
      {redeeming && redeemGain && (
        <ConfirmSheet title={`赎回这笔理财 ${formatAmount(redeeming.principal)} HTB？`} confirm="赎回" busy={busy}
          text={`按现在的价值 ${formatCenti(redeeming.value_centi)} HTB 转回活期，${redeemGain.text}。赎回后不再随指数涨跌。`}
          onConfirm={redeem} onClose={() => { setRedeeming(null); setError(null); }}>
          {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
        </ConfirmSheet>
      )}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </>
  );
}

// 贷款 (PHASE-2.md §10.3–10.9, design system Loan): from loan_quote, the score with the limit, this week's rate and the
// term's end on top; under it a new loan, the open loan with its plan and 还款, or why there can be neither (`blocked`).
// 放款 and 还款 are checked once more in a sheet; a refusal stays in the sheet. What a payment pays (next.amount, payoff)
// is the server's; a 还款 that settles the loan leaves it shown as 已结清 for the rest of the visit.
export function LoanPanel(props: Props) {
  const { student, served, onEnd, onReverse } = props;
  const curve = useGaugeCurve();
  const settings = useLoanSettings();
  const done = served.length + served.filter((s) => s.reversed).length;
  const quote = useQuery({ queryKey: ['loan-quote', student.student_no, done], queryFn: () => loanQuote(student.student_no) });
  const [settled, setSettled] = useState<{ loan: LoanDetail; txnId: string } | null>(null);
  const q = quote.data;
  const inactive = INACTIVE[student.status];
  const loan = q?.loan ?? null;
  const shownSettled = settled && served.some((s) => s.txnId === settled.txnId && !s.reversed) ? settled.loan : null;
  const penalty = (l: LoanDetail) => (settings ? rateText(penaltyRate(l.rate, settings.multiplier)) : '…');
  const idle = (left: ReactNode) => (
    <div className="dc-split">
      <section className="dc-stack">{left}</section>
      <Receipt served={served} onEnd={onEnd} onReverse={onReverse} after={null} current={null} />
    </div>
  );

  if (quote.error) return idle(<Notice tone="danger" title="暂时无法读取贷款">请检查网络后再试一次。</Notice>);
  if (!q) return idle(<KvLoading rows={3} />);
  const late = loan?.status === 'overdue' ? overdueText(loan.schedule) : null;
  const card = loan && (
    <>
      <p className="dc-caption">先还清这笔贷款，才能办新贷款或新定期。</p>
      {late && (
        <Notice tone="danger" title="贷款已逾期">
          {late.text}。逾期的本金按罚息计息{settings?.overdueWeek ? `，每满一周再扣 ${settings.overdueWeek} 分` : ''}。
        </Notice>
      )}
      <LoanCard loan={loan} penalty={penalty(loan)} />
      <p className="dc-list-title">还款计划</p>
      <PeriodList schedule={loan.schedule} plan={loan.plan} />
    </>
  );
  const blocked = !loan && (
    q.blocked === 'STUDENT_INACTIVE' ? `${inactive ?? '账户不可办理'}，不能贷款。`
    : q.blocked === 'NO_TERM' ? explain('NO_TERM', { business: '贷款' }).text
    : q.blocked === 'CREDIT_TOO_LOW' || q.limit === null ? explain('CREDIT_TOO_LOW', { score: q.score, min_score: curve.min ?? 400 }).text
    : termTooShort(q));

  return (
    <>
      <section className="dc-card dc-credit-summary">
        <dl className="dc-kv">
          <div><dt>单笔额度</dt><dd>{q.limit === null ? '不能贷款' : `${formatAmount(q.limit)} HTB`}</dd></div>
          <div><dt>本周贷款利率</dt><dd>{q.rate == null ? '不能贷款' : rateText(q.rate)}</dd></div>
          <div><dt>最晚应还日</dt><dd>{q.term ? <>{monthDay(q.term.ends_on)}<small>学期末</small></> : '不在学期内'}</dd></div>
        </dl>
        <div className="dc-credit-summary-gauge"><CreditGauge score={q.score} size="md" limit={q.limit} {...curve} /></div>
      </section>
      {shownSettled && (
        <>
          <Notice tone="success" title="贷款已结清。" />
          <LoanCard loan={shownSettled} penalty={penalty(shownSettled)} />
        </>
      )}
      {loan && inactive ? idle(<>
        {card}
        <Notice title={`${inactive}，不能在柜台还款；每期应还日结束时会从活期自动扣。`} />
      </>)
        : loan ? <LoanRepay key={`${loan.id}-${loan.payments.length}`} {...props} loan={loan} balance={q.balance} top={card}
          onSettled={(l, txnId) => setSettled({ loan: l, txnId })} />
        : blocked ? idle(<Notice tone="danger" title={blocked} />)
        : <NewLoan {...props} q={q} />}
    </>
  );
}

// 这笔贷款: principal, number and plan, status; what is left, the interest so far, this period's payment as the server
// splits it, and the rates.
function LoanCard({ loan, penalty }: { loan: LoanDetail; penalty: string }) {
  const next = loan.next && repaySplit(loan, loan.next.amount);
  return (
    <section className="dc-card dc-stack" aria-label="这笔贷款">
      <div className="dc-list-item">
        <span>贷款 <b>{formatAmount(loan.principal)} HTB</b><small>{loan.loan_no} · {planText(loan.plan, loan.periods)}</small></span>
        {LOAN_TAGS[loan.status]}
      </div>
      <dl className="dc-kv">
        <div><dt>剩余本金</dt><dd>{formatAmount(loan.remaining)} HTB</dd></div>
        <div><dt>已产生利息</dt><dd>{interestText(loan.interest_centi)}</dd></div>
        {loan.next && next && <div><dt>本期应还</dt><dd>{monthDay(loan.next.due_on)} · 本金 {formatAmount(next.principal)} HTB，利息 {formatAmount(next.interest)} HTB</dd></div>}
        <div><dt>周利率</dt><dd>{rateText(loan.rate)}</dd></div>
        {loan.status === 'overdue' && <div className="is-danger"><dt>罚息利率</dt><dd>{penalty}</dd></div>}
      </dl>
    </section>
  );
}

// 新贷款: amount within the limit, purpose, plan and its length (the stepper's top is the most that ends in term), and
// into the account or in cash. The sheet shows the plan with each period's interest estimated by loan_preview.
function NewLoan({ q, student, served, onDone, onEnd, onReverse }: Props & { q: LoanQuote }) {
  const stale = useStaleRefusal();
  const { denominations } = useSettings();
  const max = q.max_periods!;
  const [text, setText] = useState('');
  const [purpose, setPurpose] = useState('');
  const [plan, setPlan] = useState<LoanPlan>('installment');
  const [n, setN] = useState(String(Math.min(4, max)));
  const [via, setVia] = useState<'account' | 'cash'>('account');
  const [id, setId] = useState(newId);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<Problem>(null);
  const amount = Number(text) || 0;
  const periods = Number(n);
  const range = { min: 1, max };
  const hint = loanAmountHint(amount, q.limit!);
  const due = lastDue(today(), periods || 1, max, q.term!.ends_on);
  const ready = !!amount && !hint.error && !!purpose.trim() && !outside(n, range);
  const payout = describeCash(makeChange(amount, denominations));
  const length = plan === 'installment' ? '期数' : '期限（周）';
  const how = `${planText(plan, periods, true)}，${via === 'account' ? '存入账户' : '付现金'}`;
  const balance = q.balance;
  const preview = useQuery({
    queryKey: ['loan-preview', student.student_no, amount, plan, periods],
    enabled: confirming,
    retry: false,
    queryFn: () => loanPreview(student.student_no, amount, plan, periods),
  });
  const p = preview.data;
  const previewError = preview.error && failure(preview.error).problem;

  async function submit() {
    if (busy) return; // the same id is idempotent on the server too
    setBusy(true);
    setError(null);
    try {
      const r = await openLoan(id, student.student_no, amount, purpose.trim(), plan, periods, via);
      onDone({ label: '贷款', amount: via === 'account' ? amount : null, txnNo: r.txn_no, txnId: r.id, loanId: r.loan.id, type: 'loan',
        detail: via === 'account' ? how : `${planText(plan, periods, true)}，付现金，配钞 ${describeCash(r.denominations ?? {})}` });
      setConfirming(false);
      setText('');
      setPurpose('');
      setId(newId());
    } catch (e) {
      stale(e);
      setError(failure(e).problem);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="dc-split">
        <section className="dc-stack">
          <label className={`dc-field ${hint.error ? 'is-error' : ''}`}>
            <span className="dc-field-label"><Icon name="loan" />贷款金额</span>
            <span className="dc-input-wrap">
              <input className="dc-input" inputMode="numeric" value={text} placeholder="请输入金额"
                onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              <span className="dc-input-unit">HTB</span>
            </span>
            <span className="dc-field-hint">{hint.error && <Icon name="warning" />}{hint.text}</span>
          </label>
          <label className="dc-field">
            <span className="dc-field-label"><Icon name="help" />用途</span>
            <span className="dc-input-wrap">
              <input className="dc-input" value={purpose} maxLength={30} placeholder="例如：买文具" onChange={(e) => setPurpose(e.target.value)} />
            </span>
            <span className="dc-field-hint">必填，最多 30 字</span>
          </label>
          <fieldset className="dc-seg" aria-label="还款方式">
            {([['installment', '分期还'], ['bullet', '一次还清']] as const).map(([value, label]) => (
              <label key={value}><input type="radio" name="loan-plan" checked={plan === value} onChange={() => setPlan(value)} /><span>{label}</span></label>
            ))}
          </fieldset>
          <div className={`dc-qty ${outside(n, range) ? '' : 'is-filled'}`}>
            <div className="dc-qty-head">
              <span className="dc-qty-face">{n || '—'}<small>{plan === 'installment' ? '期' : '周'}</small></span>
              <span className="dc-qty-sum">{length}<b>最后一期 {due.day}</b></span>
            </div>
            <Stepper label={length} value={n} onChange={setN} step={1} range={range} />
          </div>
          {due.note && <p className="dc-caption">{due.note}</p>}
          <div className="dc-choices dc-kind-withdraw" role="radiogroup" aria-label="放款方式">
            {([['account', '存入账户', `活期 +${formatAmount(amount)} HTB`], ['cash', '付现金', '按面额配钞']] as const).map(([value, name, note]) => (
              <label key={value} className="dc-choice">
                <input type="radio" name="loan-via" checked={via === value} onChange={() => setVia(value)} />
                <span><b>{name}</b><small>{note}</small></span>
              </label>
            ))}
          </div>
          {via === 'cash' && !!amount && <p className="dc-caption">配钞：{payout}</p>}
        </section>
        <Receipt served={served} onEnd={onEnd} onReverse={onReverse} after={via === 'account' ? balance + amount : balance}
          current={amount ? { label: '贷款', detail: how, amount: via === 'account' ? formatSigned(amount) : `现金 ${formatAmount(amount)}` } : null} />
      </div>
      {error && !confirming && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <Bar busy={busy} ready={ready} onClick={() => { setError(null); setConfirming(true); }} label={busy ? '正在放款' : '放款'}
        totalLabel="贷款" total={amount} note={amount ? (via === 'account' ? `存入后余额 ${formatAmount(balance + amount)} HTB` : `配钞 ${payout}`) : undefined} />
      {confirming && (
        <ConfirmSheet title={`给${student.name}放款 ${formatAmount(amount)} HTB？`} confirm="确认放款" busy={busy} ready={!!p}
          onConfirm={submit} onClose={() => { setConfirming(false); setError(null); }}>
          {previewError ? <Notice tone="danger" title={previewError.title}>{previewError.text}</Notice>
            : !p ? <KvLoading rows={4} card={false} /> : (
              <>
                <Summary rows={[
                  ['用途', purpose.trim()], ['还款方式', planText(plan, periods)], ['周利率', `${rateText(p.rate)}（还清前不变）`],
                  ['放款方式', via === 'account' ? `存入账户，活期 ${formatAmount(balance)} → ${formatAmount(balance + amount)} HTB` : `付现金，配钞 ${payout}`],
                ]} />
                <Table label="还款计划" head={['期', '应还日', '本金', '估算利息']}
                  rows={p.schedule.map((r) => [r.seq, monthDay(r.due_on), r.principal, about(r.interest_centi)])}
                  foot={['合计', '', p.schedule.reduce((s, r) => s + r.principal, 0), about(p.interest_centi)]} />
                <p className="dc-caption">利息按天算，提前还就少付。逾期部分按罚息 {rateText(p.penalty_rate)} 计息，并扣信用分。</p>
              </>
            )}
          {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
        </ConfirmSheet>
      )}
    </>
  );
}

// 还款: the amount (this period's payment by default; in cash, the notes counted), from the account or in cash, split as
// the server pays it: the interest's whole HTB first, then the principal.
function LoanRepay({ loan, balance, top, student, served, onDone, onEnd, onReverse, onSettled }: Props & {
  loan: LoanDetail; balance: number; top: ReactNode; onSettled: (l: LoanDetail, txnId: string) => void;
}) {
  const stale = useStaleRefusal();
  const { denominations } = useSettings();
  const payoff = loan.payoff!;
  const [text, setText] = useState(String(loan.next?.amount ?? payoff));
  const [payment, setPayment] = useState<'account' | 'cash'>('account');
  const [counts, setCounts] = useState<Counts>({});
  const [id] = useState(newId); // the panel draws a new form for each repayment
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<Problem>(null);
  const amount = payment === 'cash' ? cashTotal(counts) : Number(text) || 0;
  const problem = amount ? repayProblem(amount, payoff, payment, balance) : null;
  const split = repaySplit(loan, amount);
  const after = payment === 'account' ? balance - amount : balance;
  const what = `利息 ${formatAmount(split.interest)}，本金 ${formatAmount(split.principal)}`;

  async function submit() {
    if (busy) return; // the same id is idempotent on the server too
    setBusy(true);
    setError(null);
    try {
      const r = await repayLoan(id, loan.id, amount, payment, payment === 'cash' ? nonEmpty(counts) : undefined);
      const paid = r.loan.payments.find((x) => x.txn_id === r.id) ?? split;
      onDone({ label: '还款', amount: payment === 'account' ? -amount : null, txnNo: r.txn_no, txnId: r.id, loanId: loan.id, type: 'repay',
        detail: `利息 ${formatAmount(paid.interest)}，本金 ${formatAmount(paid.principal)}${payment === 'cash' ? `，现金 ${describeCash(counts)}` : ''}` });
      if (r.loan.status === 'closed') onSettled(r.loan, r.id);
      setConfirming(false);
    } catch (e) {
      stale(e);
      setError(failure(e).problem);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="dc-split">
        <section className="dc-stack">
          {top}
          <p className="dc-list-title">还款</p>
          <label className={`dc-field ${problem ? 'is-error' : ''}`}>
            <span className="dc-field-label"><Icon name="loan" />还款金额</span>
            <span className="dc-input-wrap">
              <input className="dc-input" inputMode="numeric" value={payment === 'cash' ? String(amount) : text} readOnly={payment === 'cash'}
                placeholder="请输入金额" onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              <span className="dc-input-unit">HTB</span>
            </span>
            <span className="dc-field-hint">
              {problem ? <><Icon name="warning" />{problem}</> : `${loan.next ? `本期应还 ${formatAmount(loan.next.amount)} HTB · ` : ''}全部结清 ${formatAmount(payoff)} HTB`}
            </span>
          </label>
          <fieldset className="dc-seg" aria-label="付款方式">
            {([['account', '从账户扣'], ['cash', '交现金']] as const).map(([value, label]) => (
              <label key={value}><input type="radio" name="repay-payment" checked={payment === value} onChange={() => setPayment(value)} /><span>{label}</span></label>
            ))}
          </fieldset>
          {payment === 'account' ? !problem && <p className="dc-caption">活期 {formatAmount(balance)} → {formatAmount(after)} HTB</p>
            : <CashCounter faces={denominations} counts={counts} onChange={setCounts} kind="dc-kind-withdraw" />}
        </section>
        <Receipt served={served} onEnd={onEnd} onReverse={onReverse} after={after}
          current={amount ? { label: '还款', detail: what, amount: payment === 'account' ? formatSigned(-amount) : `现金 ${formatAmount(amount)}` } : null} />
      </div>
      {error && !confirming && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <Bar busy={busy} ready={!!amount && !problem} onClick={() => { setError(null); setConfirming(true); }} label={busy ? '正在还款' : '确认还款'}
        totalLabel="还款" total={amount} note={payment === 'account' && amount ? `还款后余额 ${formatAmount(after)} HTB` : undefined} />
      {confirming && (
        <ConfirmSheet title={`${student.name}还款 ${formatAmount(amount)} HTB？`} confirm="确认还款" busy={busy}
          onConfirm={submit} onClose={() => { setConfirming(false); setError(null); }}>
          <Summary rows={[
            ['先付利息', `${formatAmount(split.interest)} HTB`], ['再还本金', `${formatAmount(split.principal)} HTB`],
            ['还后剩余本金', `${formatAmount(loan.remaining - split.principal)} HTB`],
            ['付款方式', payment === 'account' ? `从账户扣，活期 ${formatAmount(balance)} → ${formatAmount(after)} HTB` : `交现金，${describeCash(counts)}`],
          ]} />
          {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
        </ConfirmSheet>
      )}
    </>
  );
}

type Product = { id: string; name: string; price: number; stock: number; image_path: string | null };
const imageUrl = (path: string) => supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;

// 兑换: pick products, then pay from the account or in cash with change worked out.
export function ShopPanel({ student, served, onDone, onEnd, onReverse }: Props) {
  const { denominations } = useSettings();
  const products = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('id,name,price,stock,image_path').eq('listed', true)
        .order('category').order('name');
      if (error) throw error;
      return data as Product[];
    },
  });
  const stale = useStaleRefusal();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [payment, setPayment] = useState<'account' | 'cash'>('account');
  const [received, setReceived] = useState<Counts>({});
  const [id, setId] = useState(newId);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<Problem>(null);

  const list = products.data ?? [];
  const lines = list.filter((p) => cart[p.id]).map((p) => ({ ...p, qty: cart[p.id] }));
  const due = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const paid = cashTotal(received);
  const change = Math.max(paid - due, 0);
  const items = lines.map((l) => `${l.name} × ${l.qty}`).join('、');
  const setQty = (p: Product, n: number) => setCart({ ...cart, [p.id]: Math.max(0, Math.min(p.stock, n)) });
  const balance = student.balance ?? 0;
  const problem =
    !lines.length ? '请选择商品'
    : payment === 'account' && due > balance ? `余额不足，还差 ${formatAmount(due - balance)} HTB`
    : payment === 'cash' && paid < due ? `收款不足，还差 ${formatAmount(due - paid)} HTB`
    : null;

  async function submit() {
    if (busy) return; // the same id is idempotent on the server too
    setBusy(true);
    setError(null);
    try {
      const result = await purchase(id, student.student_no, lines.map((l) => ({ product_id: l.id, qty: l.qty })), payment,
        payment === 'cash' ? nonEmpty(received) : undefined);
      onDone(payment === 'account'
        ? { label: `兑换 ${items}`, detail: '账户支付', amount: -due, txnNo: result.txn_no, txnId: result.id }
        : { label: `兑换 ${items}`, amount: null, txnNo: result.txn_no, txnId: result.id,
            detail: `现金收 ${formatAmount(paid)} HTB，找零 ${formatAmount(change)} HTB（${describeCash(result.change_given ?? {}) || '不用找零'}）` });
      setCart({});
      setPayment('account');
      setReceived({});
      setId(newId());
    } catch (e) {
      stale(e);
      const { err, problem } = failure(e);
      setError(problem);
      if (err.code === 'OUT_OF_STOCK' || err.code === 'PRODUCT_UNLISTED' || err.code === 'PRODUCT_NOT_FOUND') products.refetch();
    } finally {
      setBusy(false);
      setConfirming(false);
      products.refetch();
    }
  }

  return (
    <>
      <div className="dc-split">
        <section className="dc-stack">
          <h2 className="heading">选择商品</h2>
          {products.error ? <Notice tone="danger" title="暂时无法读取商品">请检查网络后重试。</Notice> : products.isPending ? <TilesLoading /> : (
            <div className="dc-tiles">
              {list.map((p) => (
                <button key={p.id} type="button" className="dc-tile dc-kind-exchange" disabled={!p.stock} onClick={() => setQty(p, (cart[p.id] ?? 0) + 1)}
                  style={p.stock ? undefined : { opacity: 0.5, cursor: 'not-allowed' }}
                  aria-label={`${p.name}，${p.price} HTB，${p.stock ? `库存 ${p.stock}` : '已售罄'}`}>
                  <span className="dc-tile-icon">
                    {p.image_path ? <img src={imageUrl(p.image_path)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
                      : <Icon name="exchange" />}
                  </span>
                  {p.name}
                  <small>{p.price} HTB · {p.stock ? `库存 ${p.stock}` : '已售罄'}</small>
                </button>
              ))}
            </div>
          )}
          {lines.length > 0 && (
            <>
              <h2 className="heading is-section">已选商品</h2>
              <div className="dc-denoms dc-kind-exchange">
                {lines.map((l) => (
                  <div key={l.id} className="dc-qty is-product is-filled">
                    <div className="dc-qty-head">
                      <span className="dc-qty-name">{l.name}</span>
                      <QtySum amount={l.price * l.qty} />
                    </div>
                    <div className="dc-qty-ctrl">
                      <button className="dc-qty-btn" type="button" aria-label={`减少一件${l.name}`} onClick={() => setQty(l, l.qty - 1)}><Icon name="minus" /></button>
                      <input className="dc-qty-input" readOnly aria-label={`${l.name}数量`} value={l.qty} />
                      <button className="dc-qty-btn" type="button" aria-label={`增加一件${l.name}`} disabled={l.qty >= l.stock} onClick={() => setQty(l, l.qty + 1)}><Icon name="plus" /></button>
                    </div>
                  </div>
                ))}
              </div>
              <h2 className="heading is-section">付款方式</h2>
              <div className="dc-choices dc-kind-exchange" role="radiogroup" aria-label="付款方式">
                {([['account', 'savings', '账户扣款', `可用余额 ${formatAmount(balance)} HTB`], ['cash', 'coin', '现金支付', '收款并找零']] as const)
                  .map(([value, icon, name, note]) => (
                    <label key={value} className="dc-choice">
                      <input type="radio" name="payment" checked={payment === value} onChange={() => setPayment(value)} />
                      <span className="dc-choice-icon"><Icon name={icon} /></span>
                      <span><b>{name}</b><small>{note}</small></span>
                    </label>
                  ))}
              </div>
              {payment === 'cash' && (
                <>
                  <h2 className="heading is-section">录入收到的现金</h2>
                  <CashCounter faces={denominations} counts={received} onChange={setReceived} kind="dc-kind-exchange" />
                </>
              )}
            </>
          )}
        </section>
        <Receipt served={served} onEnd={onEnd} onReverse={onReverse} after={payment === 'account' ? Math.max(balance - due, 0) : balance}
          current={lines.length ? {
            label: `兑换 ${items}`,
            detail: payment === 'account' ? '账户支付'
              : `现金收 ${formatAmount(paid)} HTB${change ? `，找零 ${describeCash(makeChange(change, denominations))}` : ''}`,
            amount: payment === 'account' ? formatSigned(-due) : '现金',
          } : null} />
      </div>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <Bar busy={busy} ready={!problem} onClick={() => setConfirming(true)}
        label={busy ? '正在兑换' : problem ?? `确认兑换 ${formatAmount(due)} HTB`}
        totalLabel="应付" total={due} note={payment === 'cash' && change > 0 && `找零 ${formatAmount(change)} HTB`} />
      {confirming && (
        <ConfirmSheet title={`为${student.name}兑换 ${formatAmount(due)} HTB 的商品？`} text="请核对商品和付款方式，确认后把商品交给学生。"
          confirm="确认兑换" busy={busy} onConfirm={submit} onClose={() => setConfirming(false)}>
          <Summary rows={[
            ['学生', `${student.name} · 学号 ${student.student_no}`], ['商品', items], ['应付', `${formatAmount(due)} HTB`],
            ...(payment === 'account'
              ? [['付款方式', '账户扣款'], ['扣款后余额', `${formatAmount(Math.max(balance - due, 0))} HTB`]] as [string, string][]
              : [['付款方式', '现金支付'], ['收款', `${formatAmount(paid)} HTB`],
                  ['找零', change ? `${formatAmount(change)} HTB（${describeCash(makeChange(change, denominations))}）` : '不用找零']] as [string, string][]),
          ]} />
        </ConfirmSheet>
      )}
    </>
  );
}

const HISTORY = 10;
type HistoryRow = Omit<TxnRow, 'txn_items'> & { seq: number; txn_no: string; balance_after: number; operator: string; items: { name: string; qty: number }[] };

const QUERY_KINDS = [['deposit', '存款'], ['withdraw', '取款'], ['purchase', '兑换'], ['reversal', '冲正'], ['salary', '工资'], ['interest', '利息'], ['opening', '期初']] as const;

// 查询: the student's account totals and every transaction, also other tellers' and earlier days', newest first,
// ten at a time (student_txns), filtered as 流水 is: the days, a 时段, the types, and words of a 交易号 or a product.
// It takes the whole width; the 办理单 is back with the next business. Read again after each business of the visit.
export function QueryPanel({ student, served }: Props) {
  const done = served.length + served.filter((s) => s.reversed).length;
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const account = useQuery({
    queryKey: ['counter-account', student.student_no, done],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('balance,total_in,total_out,total_spent,term_total').eq('student_no', student.student_no).single();
      if (error) throw error;
      return data;
    },
  });
  const badTime = wrongTimes(filter);
  const history = useInfiniteQuery({
    queryKey: ['counter-history', student.student_no, done, filter],
    enabled: !badTime,
    initialPageParam: null as number | null,
    getNextPageParam: (last: HistoryRow[]) => (last.length === HISTORY ? last[last.length - 1].seq : undefined),
    queryFn: ({ pageParam }) => call<HistoryRow[]>('student_txns', {
      p_student_no: student.student_no, p_before: pageParam, p_limit: HISTORY, p_from: filter.from || null, p_to: filter.to || null,
      p_time_from: filter.timeFrom || null, p_time_to: filter.timeTo || null, p_types: filter.kinds.length ? filter.kinds : null,
      p_search: filter.text.trim() || null,
    }),
  });
  const rows = history.data?.pages.flat();
  const a = account.data;
  const fresh = useNewRows(rows?.map((r) => r.id), JSON.stringify(filter));
  return (
    <section className="dc-stack dc-enter" aria-label="账户查询">
      {a ? (
        <Stats items={[['当前余额', formatAmount(a.balance), 'HTB'], ['累计存入', formatAmount(a.total_in), 'HTB'],
          ['累计取出', formatAmount(a.total_out), 'HTB'], ['累计账户兑换', formatAmount(a.total_spent), 'HTB'], ['定期合计', formatAmount(a.term_total), 'HTB'],
          ['贷款剩余', formatAmount(student.loan_remaining ?? 0), 'HTB']]} />
      ) : account.error ? <Notice tone="danger" title="暂时无法读取账户">请检查网络后再试一次。</Notice> : <KvLoading rows={2} />}
      <FilterBar label="筛选交易记录" placeholder="搜索交易号或商品" value={filter} onChange={setFilter} kinds={QUERY_KINDS} />
      {badTime ? <Notice tone="danger" title="时段有误">结束时间要晚于开始时间。</Notice>
        : history.error && !rows ? <Notice tone="danger" title="暂时无法读取交易记录">请检查网络后再试一次。</Notice>
        : !rows ? <TxnListLoading />
        : rows.length ? (
          <ul className="dc-txns" aria-label="交易记录">
            {rows.map((r) => {
              const t = toTxn({ ...r, txn_items: r.items });
              return (
                <li key={r.id} className={`dc-txn ${t.kind} ${fresh.has(r.id) ? 'is-new' : ''}`} style={r.status === 'reversed' ? { opacity: 0.6 } : undefined}>
                  <span className="dc-txn-icon"><Icon name={t.icon} /></span>
                  <div className="dc-txn-main">
                    <div className="dc-txn-title">{t.title}</div>
                    <div className="dc-txn-time">{t.time} · 经办人 {r.operator}</div>
                    <div className="dc-txn-time">交易号 {r.txn_no} · 办理后余额 {formatAmount(r.balance_after)} HTB</div>
                  </div>
                  <div className={`dc-txn-amount ${t.amount > 0 ? 'is-in' : ''}`}>
                    {t.amount ? formatSigned(t.amount) : formatAmount(t.paid)}<small>{t.note}</small>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="dc-top-sub">{filtered(filter) ? '没有符合条件的交易记录。' : '还没有交易记录。'}</p>}
      {history.isFetchingNextPage && <TxnListLoading rows={2} />}
      {history.error && rows && <Notice tone="danger" title="暂时无法读取更多记录">请检查网络后再试一次。</Notice>}
      {history.hasNextPage && !history.isFetchingNextPage && (
        <button className="dc-btn dc-btn-secondary dc-btn-block" type="button" onClick={() => history.fetchNextPage()}>加载更多</button>
      )}
    </section>
  );
}
