import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SHIFTS } from '@/lib/attendance';
import { dutyCount, dutySummary, useDuty } from '@/lib/duty';
import { AppError, explain } from '@/lib/errors';
import { formatTime, shiftAt } from '@/lib/format';
import { useOnline } from '@/lib/online';
import { call } from '@/lib/rpc';
import type { Me } from '@/lib/session';
import { OutputSheet } from './Output';
import { ConfirmSheet } from './Sheet';
import { Icon, Notice } from './ui';

// 上班 / 下班 (PHASE-1.md §7.5): 上班 opens the counter (and signs the shift for a counted teller); 下班 first prints
// the summary of every transaction since 上班, then, once it is signed, closes the duty; 跳过打印 goes straight to
// the confirmation. `whole`: the card is all the
// page has (办理 before 上班), so it is drawn large.
export function DutyCard({ me, whole }: { me: Me; whole?: boolean }) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const duty = useDuty(me.profile.id);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'print' | 'confirm' | null>(null);
  const [count, setCount] = useState(0);
  const [printed, setPrinted] = useState(true);
  const [problem, setProblem] = useState<{ title: string; text: string } | null>(null);
  const d = duty.data;
  const refresh = () => Promise.all(['duty', 'attendance'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));

  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await call(fn, args);
    } catch (err) {
      setProblem(err instanceof AppError ? explain(err.code, err.detail) : explain(''));
    } finally {
      setStep(null);
      setBusy(false);
      await refresh();
    }
  }

  const start = (
    <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button" disabled={!online || busy || duty.isPending}
      onClick={() => run('start_duty', {})}><Icon name="check" />上班</button>
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
      ) : whole && !d ? (
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
