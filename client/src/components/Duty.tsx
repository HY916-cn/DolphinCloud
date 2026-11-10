import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SHIFTS } from '@/lib/attendance';
import { cashTotal, type Counts } from '@/lib/cash';
import { useSettings } from '@/lib/counter';
import { dutyCount, dutySummary, lastFloat, staleDuty, useDuty } from '@/lib/duty';
import { AppError, explain } from '@/lib/errors';
import { formatTime, shiftAt } from '@/lib/format';
import { useOnline } from '@/lib/online';
import { call } from '@/lib/rpc';
import type { Me } from '@/lib/session';
import { CashCounter, Summary } from './Counter';
import { OutputSheet } from './Output';
import { ConfirmSheet } from './Sheet';
import { DenomsLoading } from './Skeleton';
import { Icon, Notice } from './ui';

// 登记备用金 before 上班: the notes in the cash box, by default those of the last 上班; every face 0 before the first or
// when the last cannot be read. The buttons are the page's ActionBar, after the card.
function FloatCard({ uid, busy, onCancel, onConfirm }: { uid: string; busy: boolean; onCancel: () => void; onConfirm: (float: Counts) => void }) {
  const { denominations } = useSettings();
  const online = useOnline();
  const last = useQuery({ queryKey: ['duty', uid, 'float'], queryFn: () => lastFloat(uid), staleTime: 0 });
  const [edited, setEdited] = useState<Counts | null>(null);
  const counts = edited ?? last.data ?? {};
  const float = Object.fromEntries(denominations.map((f) => [f, counts[f] ?? 0])); // every face, as start_duty takes it
  return (
    <>
      <div className="dc-card dc-stack">
        <h2 className="heading">登记备用金</h2>
        <p className="dc-top-sub" style={{ margin: 0 }}>储蓄盒里现有的零钱。默认是上次登记的备用金，按实际张数修改，没有就填 0。</p>
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

// 上班 / 下班 (PHASE-1.md §7.5): 上班 first records the 备用金, then opens the counter (and signs the shift for a
// counted teller); 下班 first prints the summary of every transaction since 上班, then, once it is signed, closes the
// duty; 跳过打印 goes straight to the confirmation. A duty left open overnight (is-stale) asks for 下班 before anything
// else. `whole`: the card is all the page has (办理 before 上班, or after a duty left open overnight), so it is drawn
// large, and the 备用金 card takes its place.
export function DutyCard({ me, whole }: { me: Me; whole?: boolean }) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const duty = useDuty(me.profile.id);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'print' | 'confirm' | null>(null);
  const [registering, setRegistering] = useState(false);
  const [count, setCount] = useState(0);
  const [printed, setPrinted] = useState(true);
  const [problem, setProblem] = useState<{ title: string; text: string } | null>(null);
  const d = duty.data;
  const stale = staleDuty(d);
  const staleText = d && `从 ${formatTime(d.started_at)} 开始，已经跨天。先下班，再重新上班。`;
  const refresh = () => Promise.all(['duty', 'attendance'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));

  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setProblem(null);
    let done = false;
    try {
      await call(fn, args);
      done = true;
    } catch (err) {
      setProblem(err instanceof AppError && err.code === 'INVALID_AMOUNT' ? { title: '备用金张数有误', text: '每种面额填 0 或正整数。' }
        : err instanceof AppError ? explain(err.code, err.detail) : explain(''));
    } finally {
      setStep(null);
      setBusy(false);
      await refresh();
      if (done) setRegistering(false); // once 上班 is read again, so the empty card does not flash back
    }
  }

  const start = (
    <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button" disabled={!online || busy || duty.isPending}
      onClick={() => setRegistering(true)}><Icon name="check" />上班</button>
  );
  const float = !d && registering && (
    <FloatCard uid={me.profile.id} busy={busy} onCancel={() => setRegistering(false)} onConfirm={(f) => run('start_duty', { p_float: f })} />
  );
  // A duty left open overnight ends as any other, through the summary.
  const end = (
    <button className="dc-btn dc-btn-primary" type="button" disabled={!online || busy} onClick={() => setStep('print')}>
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
      ) : whole && stale ? (
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
          {start}
        </div>
      ) : (
        <div className="dc-card dc-duty">
          <span className="dc-duty-main">
            <b>{d ? `已上班 · ${formatTime(d.started_at)} 起` : '未上班'}</b>
            <small className="dc-top-sub">{d ? `现在是${SHIFTS[shiftAt(new Date())]}；下班前先打印本次的业务总结，签字留存` : '13:30 之前为中午班，13:30 起为下午班'}</small>
          </span>
          {d ? (
            <button className="dc-btn dc-btn-secondary" type="button" disabled={!online || busy} onClick={() => setStep('print')}>
              <Icon name="logout" />下班
            </button>
          ) : start}
        </div>
      )}
      {!whole && float}
      {step === 'print' && d && (
        <OutputSheet title="打印下班总结" name={`下班总结-${me.profile.display_name}-${formatTime(new Date().toISOString(), new Date(0))}.pdf`}
          text="总结列出本次上班以来你办理的全部业务。打印后核对、签字留存，再确认下班。"
          make={async () => { const r = await dutySummary(d, me.profile.display_name); setCount(r.count); return r.pages; }}
          onClose={() => setStep(null)} onDone={() => { setPrinted(true); setStep('confirm'); }}
          extra={
            <button className="dc-btn dc-btn-ghost dc-btn-sm dc-btn-block" type="button" disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                setCount(await dutyCount());
                setPrinted(false);
                setStep('confirm');
              } catch {
                setProblem(explain(''));
                setStep(null);
              } finally {
                setBusy(false);
              }
            }}>跳过打印</button>
          } />
      )}
      {step === 'confirm' && (
        <ConfirmSheet title="确认下班？"
          text={printed ? `总结共 ${count} 笔业务。确认已打印并签字留存；下班后不能再办理业务，需要时再点「上班」。`
            : `本次上班共 ${count} 笔业务，没有打印总结。下班后不能再办理业务，需要时再点「上班」。`}
          confirm={printed ? '已签字，确认下班' : '确认下班'} busy={busy} onClose={() => setStep(null)} onConfirm={() => run('end_duty', { p_txns: count })} />
      )}
    </section>
  );
}
