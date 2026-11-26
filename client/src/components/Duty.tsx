import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SHIFTS } from '@/lib/attendance';
import { cashCell, cashTotal, compareCash, diffAmount, diffFaces, isBalanced, type Counts } from '@/lib/cash';
import { useSettings } from '@/lib/counter';
import { defaultFloat, dutyCash, dutyCount, dutySummary, staleDuty, useDuty, type Duty } from '@/lib/duty';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatTime, shiftAt } from '@/lib/format';
import { useOnline } from '@/lib/online';
import { call } from '@/lib/rpc';
import type { Me } from '@/lib/session';
import { CashReason, cashRefusal, CashTxns, type CashProblem } from './Cash';
import { CashCounter, Summary } from './Counter';
import { OutputSheet } from './Output';
import { ConfirmSheet } from './Sheet';
import { DenomsLoading } from './Skeleton';
import { Icon, Notice } from './ui';

// 登记备用金 before 上班: the notes in the cash box, by default what the server gives (default_float: the last 下班's
// count as the accountant left it); every face 0 when it cannot be read. The buttons are the page's ActionBar, after the card.
function FloatCard({ uid, busy, onCancel, onConfirm }: { uid: string; busy: boolean; onCancel: () => void; onConfirm: (float: Counts) => void }) {
  const { denominations } = useSettings();
  const online = useOnline();
  const last = useQuery({ queryKey: ['duty', uid, 'float'], queryFn: defaultFloat, staleTime: 0 });
  const [edited, setEdited] = useState<Counts | null>(null);
  const counts = edited ?? last.data ?? {};
  const float = Object.fromEntries(denominations.map((f) => [f, counts[f] ?? 0])); // every face, as start_duty takes it
  return (
    <>
      <div className="dc-card dc-stack">
        <h2 className="heading">登记备用金</h2>
        <p className="dc-caption">储蓄盒里现有的零钱。默认是上次下班时点出的张数，复核改过的按复核的数；按实际张数修改，没有就填 0。</p>
        {last.isError && <Notice title="没有读到上次的备用金，已全部填 0" />}
        {last.isPending ? <DenomsLoading count={denominations.length} label="正在读取上次的备用金" />
          : <CashCounter faces={denominations} counts={counts} onChange={setEdited} kind="" />}
        <Summary rows={[]} total={['备用金合计', cashTotal(float)]} />
      </div>
      <div className="dc-actions is-row">
        <button className="dc-btn dc-btn-secondary" type="button" disabled={busy} onClick={onCancel}>取消</button>
        <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button" disabled={!online || busy || last.isPending}
          onClick={() => onConfirm(float)}><Icon name="check" />确认上班</button>
      </div>
    </>
  );
}

// 下班 (design system CashCount 柜台：下班): count the cash box, 核对 it against what it should hold, print the summary
// and confirm. A box that does not balance shows its cash businesses and needs the reason. The server's difference
// (NOTE_REQUIRED.diff) is the one that stands. 跳过打印 and 下班 without printing go to the confirmation too.
function CountCard({ me, duty, onCancel, onDone }: { me: Me; duty: Duty; onCancel: () => void; onDone: () => void }) {
  const online = useOnline();
  const cash = useQuery({ queryKey: ['duty', duty.id, 'cash'], queryFn: () => dutyCash(), staleTime: 0 });
  const [counts, setCounts] = useState<Counts>({});
  const [diff, setDiff] = useState<Counts | null>(null);
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'print' | 'confirm' | null>(null);
  const [txns, setTxns] = useState(0);
  const [printed, setPrinted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CashProblem>(null);
  const [refused, setRefused] = useState<CashProblem>(null);
  const expected = cash.data?.expected.counts;
  const faces = cash.data?.denominations ?? [];
  const counted: Counts = Object.fromEntries(faces.map((f) => [f, counts[f] ?? 0]));
  const total = cashTotal(counted);
  const balanced = !!diff && isBalanced(diff);
  const change = (c: Counts) => { setCounts(c); setDiff(null); setProblem(null); };

  async function skipPrint() {
    setBusy(true);
    try {
      setTxns(await dutyCount());
      setPrinted(false);
      setRefused(null);
      setStep('confirm');
    } catch {
      setProblem(explain(''));
      setStep(null);
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    setBusy(true);
    setRefused(null);
    try {
      await call('end_duty', { p_txns: txns, p_count: counted, p_note: note.trim() || null });
      onDone();
    } catch (err) {
      // Not ended: the server's difference replaces this one, and the result shows again with its reason field.
      if (err instanceof AppError && err.code === 'NOTE_REQUIRED' && err.detail.diff) {
        setDiff(err.detail.diff as Counts);
        setProblem(cashRefusal(err, 'end'));
        setStep(null);
      } else {
        setRefused(cashRefusal(err, 'end'));
      }
    } finally {
      setBusy(false);
    }
  }

  const result = diff && (balanced ? '平账' : diffAmount(diff));
  return (
    <>
      <section className="dc-card dc-stack" aria-label="点储蓄盒">
        <h2 className="heading">点储蓄盒</h2>
        <p className="dc-caption">按面额数一遍储蓄盒，录入实际张数。应有 = 备用金 + 收入 − 付出，不含已冲正的业务。</p>
        {cash.isError ? (
          <Notice tone="danger" title="暂时无法读取本次上班的现金">
            请检查网络后重试。
            <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={() => cash.refetch()}>重试</button>
          </Notice>
        ) : !cash.data ? <DenomsLoading count={4} label="正在读取本次上班的现金" /> : (
          <>
            <CashCounter faces={faces} counts={counted} onChange={change} kind="" what="实点张数" diff={diff}
              sum={(f) => { const n = cash.data.expected.counts[f] ?? 0; return <span className="dc-qty-sum">应有<b className={n < 0 ? 'is-danger' : undefined}>{cashCell(n, true).text}</b></span>; }} />
            <Summary rows={[['应有合计', `${formatAmount(cash.data.expected.total)} HTB`]]} total={['实点合计', total]} />
          </>
        )}
        {problem && <Notice tone="danger" title={problem.title}>{problem.text}</Notice>}
        {diff && (balanced ? (
          <Notice tone="success" title="平账">各面额都和应有相符。打印下班总结，签字后确认下班。</Notice>
        ) : (
          <>
            <Notice tone="danger" title={`不平账，${result}`}>{diffFaces(diff)}。对照下面的现金业务再点一遍；确实不平，写明原因再下班。</Notice>
            <p className="dc-list-title">本次上班的现金业务</p>
            {cash.data && <CashTxns txns={cash.data.cash_txns} />}
            <CashReason value={note} onChange={setNote} hint="必填，最多 100 字，例如：找零多给了 1 张 5 元" />
            <p className="dc-caption">不平账会记一条风险提醒，复核时再点一遍储蓄盒。</p>
          </>
        ))}
      </section>
      <div className="dc-actions is-row">
        {diff ? (
          <>
            <button className="dc-btn dc-btn-secondary" type="button" disabled={!online || busy} onClick={() => setStep('print')}>打印总结</button>
            <button className={`dc-btn dc-btn-primary ${busy && !step ? 'is-loading' : ''}`} type="button" disabled={!online || busy || (!balanced && !note.trim())}
              onClick={skipPrint}><Icon name="logout" />下班</button>
          </>
        ) : (
          <>
            <button className="dc-btn dc-btn-secondary" type="button" disabled={busy} onClick={onCancel}>取消</button>
            <button className="dc-btn dc-btn-primary" type="button" disabled={!expected} onClick={() => setDiff(compareCash(expected!, counted))}>
              <Icon name="check" />核对
            </button>
          </>
        )}
      </div>
      {step === 'print' && (
        <OutputSheet title="打印下班总结" name={`下班总结-${me.profile.display_name}-${formatTime(new Date().toISOString(), new Date(0))}.pdf`}
          text="总结列出本次上班以来你办理的全部业务。打印后核对、签字留存，再确认下班。"
          make={async () => { const r = await dutySummary(duty, me.profile.display_name); setTxns(r.count); return r.pages; }}
          onClose={() => setStep(null)} onDone={() => { setPrinted(true); setRefused(null); setStep('confirm'); }}
          extra={<button className="dc-btn dc-btn-ghost dc-btn-sm dc-btn-block" type="button" disabled={busy} onClick={skipPrint}>跳过打印</button>} />
      )}
      {step === 'confirm' && (
        <ConfirmSheet title="确认下班？"
          text={`实点 ${formatAmount(total)} HTB，${balanced ? '平账。' : `${result}，原因：${note.trim()}。`}${printed
            ? `总结共 ${txns} 笔业务。确认已打印并签字留存；下班后不能再办理业务，需要时再点「上班」。`
            : `本次上班共 ${txns} 笔业务，没有打印总结。下班后不能再办理业务，需要时再点「上班」。`}`}
          confirm={printed ? '已签字，确认下班' : '确认下班'} busy={busy} onClose={() => setStep(null)} onConfirm={end}>
          {refused && <Notice tone="danger" title={refused.title}>{refused.text}</Notice>}
        </ConfirmSheet>
      )}
    </>
  );
}

// 上班 / 下班 (PHASE-1.md §7.5): 上班 first records the 备用金, then opens the counter (and signs the shift for a
// counted teller); 下班 counts the cash box first (CountCard). A duty left open overnight (is-stale) asks for 下班 before
// anything else. `whole`: the card is all the page has (办理 before 上班, or after a duty left open overnight), so it is
// drawn large, and the 备用金 or 点储蓄盒 card takes its place.
export function DutyCard({ me, whole }: { me: Me; whole?: boolean }) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const duty = useDuty(me.profile.id);
  const [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [counting, setCounting] = useState(false);
  const [problem, setProblem] = useState<{ title: string; text: string } | null>(null);
  const d = duty.data;
  const stale = staleDuty(d);
  const staleText = d && `从 ${formatTime(d.started_at)} 开始，已经跨天。先下班，再重新上班。`;
  const refresh = () => Promise.all(['duty', 'attendance'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));

  async function start(float: Counts) {
    setBusy(true);
    setProblem(null);
    try {
      await call('start_duty', { p_float: float });
      await refresh();
      setRegistering(false); // once 上班 is read again, so the empty card does not flash back
    } catch (err) {
      setProblem(err instanceof AppError && err.code === 'INVALID_AMOUNT' ? { title: '备用金张数有误', text: '每种面额填 0 或正整数。' }
        : err instanceof AppError ? explain(err.code, err.detail) : explain(''));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const startButton = (
    <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button" disabled={!online || busy || duty.isPending}
      onClick={() => setRegistering(true)}><Icon name="check" />上班</button>
  );
  const float = !d && registering && (
    <FloatCard uid={me.profile.id} busy={busy} onCancel={() => setRegistering(false)} onConfirm={start} />
  );
  const count = d && counting && (
    <CountCard key={d.id} me={me} duty={d} onCancel={() => setCounting(false)}
      onDone={async () => { await refresh(); setCounting(false); }} />
  );
  // A duty left open overnight ends as any other, by counting the box.
  const end = (
    <button className="dc-btn dc-btn-primary" type="button" disabled={!online || counting} onClick={() => setCounting(true)}>
      <Icon name="logout" />下班
    </button>
  );

  return (
    <section className="dc-stack" aria-label="上下班">
      {problem && <Notice tone="danger" title={problem.title}>{problem.text}</Notice>}
      {whole && d === undefined ? (
        // Not known yet: the counter stays closed until the server says the teller is on duty.
        duty.isError || duty.fetchStatus === 'paused' ? (
          <Notice tone="danger" title="暂时无法确认上班状态">
            请检查网络后重试。
            <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={() => duty.refetch()}>重试</button>
          </Notice>
        ) : <div className="dc-card dc-skeleton" style={{ height: 200 }} role="status" aria-label="正在读取上班状态" />
      ) : whole && count ? count : whole && stale ? (
        <div className="dc-card dc-empty">
          <span className="dc-empty-icon is-danger"><Icon name="warning" /></span>
          <h3>上次上班还没下班</h3>
          <p>{staleText}</p>
          {end}
        </div>
      ) : stale ? (
        <div className="dc-card dc-duty is-stale">
          <span className="dc-duty-main">
            <b>上次上班还没下班</b>
            <small className="dc-top-sub"><Icon name="warning" />{staleText}</small>
          </span>
          {end}
        </div>
      ) : whole && float ? float : whole && !d ? (
        <div className="dc-card dc-empty">
          <span className="dc-empty-icon"><Icon name="clock" /></span>
          <h3>未上班</h3>
          <p>13:30 之前为中午班，13:30 起为下午班。</p>
          {startButton}
        </div>
      ) : (
        <div className="dc-card dc-duty">
          <span className="dc-duty-main">
            <b>{d ? `已上班 · ${formatTime(d.started_at)} 起` : '未上班'}</b>
            <small className="dc-top-sub">{d ? `现在是${SHIFTS[shiftAt(new Date())]}；下班前先点储蓄盒，打印本次的业务总结` : '13:30 之前为中午班，13:30 起为下午班'}</small>
          </span>
          {d ? (
            <button className="dc-btn dc-btn-secondary" type="button" disabled={!online || counting} onClick={() => setCounting(true)}>
              <Icon name="logout" />下班
            </button>
          ) : startButton}
        </div>
      )}
      {!whole && float}
      {!whole && count}
    </section>
  );
}
