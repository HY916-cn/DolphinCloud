import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { AlertTag, ConfirmSheet, Icon, KvLoading, link, Notice, Page, SheetList, Summary, useWide } from '@/components';
import { alertLink, alertObject, alertRows, alertsHref, clock, handledBy, KINDS, termination, type Alert } from '@/lib/alerts';
import { classOf } from '@/lib/counter';
import { AppError, alertRefusal, explain } from '@/lib/errors';
import { call } from '@/lib/rpc';
import { supabase } from '@/lib/supabase';

type Problem = { title: string; text: string } | null;

// One alert (design system RiskAlerts 提醒页): 这条提醒, and while it is open 处理: a note, 已查看, and for the kinds that
// can be undone 终止 with its reason and a second look. Its title is the kind and its subtitle the object. The list's
// filters ride along in the address, so 返回 and a handled alert land on the list as it was; from 总览 (`via=overview`)
// 返回 goes back there. There is no read of one alert: list_risk_alerts below id + 1, one row, is it or there is none.
export default function AlertPage() {
  const { id, tab, from, to, kinds, via } = useLocalSearchParams<{ id: string; tab?: string; from?: string; to?: string; kinds?: string; via?: string }>();
  const filters = { tab, from, to, kinds };
  const alert = useQuery({
    queryKey: ['risk-alert', id],
    queryFn: async () => {
      const [a] = await call<Alert[]>('list_risk_alerts', { p_before: Number(id) + 1, p_limit: 1 });
      return a?.id === Number(id) ? a : null;
    },
  });
  const a = alert.data;
  const back = () => router.navigate((via === 'overview' ? '/admin' : alertsHref(filters)) as Href);
  return (
    <Page title={a ? KINDS[a.kind].name : '风险提醒'} sub={a ? alertObject(a) : undefined} back={back}>
      {alert.isError ? <Notice tone="danger" title="暂时无法读取这条提醒">请检查网络后刷新页面。</Notice>
        : alert.isPending ? <KvLoading rows={6} />
        : !a ? <Notice tone="danger" title="找不到这条提醒">请返回风险提醒页刷新后再试。</Notice>
        : <Handle key={a.id} a={a} onDone={() => router.navigate(alertsHref({ ...filters, fresh: String(a.id) }) as Href)} />}
    </Page>
  );
}

function Handle({ a, onDone }: { a: Alert; onDone: () => void }) {
  const queryClient = useQueryClient();
  const wide = useWide();
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const student = useQuery({
    queryKey: ['students', a.student_no, 'class'],
    enabled: !!a.student_no && a.kind !== 'credit_switch',
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('class_label,class_no').eq('student_no', a.student_no!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const end = termination(a, note.trim());
  const go = alertLink(a);

  async function handle(action: 'seen' | 'terminate') {
    setBusy(true);
    setProblem(null);
    try {
      const done = await call<{ alert: Alert }>('handle_alert', { p_id: a.id, p_action: action, p_note: note.trim() || null });
      queryClient.setQueryData(['risk-alert', String(a.id)], done.alert);
      queryClient.invalidateQueries({ queryKey: ['risk-alerts'] });
      onDone();
    } catch (err) {
      setConfirming(false);
      setBusy(false);
      setProblem(err instanceof AppError ? alertRefusal(err.code, err.detail, a.kind) : explain(''));
      // Someone else handled it first: read it again, and the page turns read-only with the notice on top.
      if (err instanceof AppError && err.code === 'ALERT_HANDLED') {
        queryClient.invalidateQueries({ queryKey: ['risk-alerts'] });
        await queryClient.invalidateQueries({ queryKey: ['risk-alert', String(a.id)] });
      }
    }
  }
  function terminate() {
    if (!note.trim()) {
      setMissing(true);
      return;
    }
    setConfirming(true);
  }

  const object: [string, ReactNode][] = a.kind === 'reversal_many' || a.kind === 'cash_unbalanced' ? [['柜员', alertObject(a)]]
    : a.kind === 'setting_change' ? [['参数', alertObject(a)]]
    : a.kind === 'stock_low' ? [['商品', alertObject(a)]]
    : a.kind === 'credit_switch' ? [['对象', alertObject(a)]]
    : [['学生', [alertObject(a), student.data && classOf(student.data), a.student_no].filter(Boolean).join(' · ')]];
  const rows: [string, ReactNode][] = [
    ['时间', clock(a.at)], ['种类', KINDS[a.kind].name], ['状态', <AlertTag key="s" status={a.status} />], ...object,
    ...alertRows(a).map(([k, v, danger]): [string, ReactNode] => [k, danger ? <span key={k} className="is-danger">{v}</span> : v]),
    ...(a.status !== 'open' ? [['处理', handledBy(a)] as [string, ReactNode]] : []),
    ...(a.note ? [['处理说明', a.note] as [string, ReactNode]] : []),
  ];
  const refusal = problem && <Notice tone="danger" title={problem.title}>{problem.text}</Notice>;
  const shown = (
    <section className="dc-card dc-stack" aria-label="这条提醒">
      <h2 className="heading">这条提醒</h2>
      <Summary rows={rows} />
      {go && <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link(go.href)}>{go.label}<Icon name="next" /></a>}
    </section>
  );
  if (a.status !== 'open') return <div className="dc-stack dc-enter">{refusal}{shown}</div>;

  const work = (
    <section className="dc-card dc-stack" aria-label="处理">
      <h2 className="heading">处理</h2>
      {refusal}
      <label className={`dc-field ${missing && !note.trim() ? 'is-error' : ''}`}>
        <span className="dc-field-label"><Icon name="help" />说明</span>
        <span className="dc-input-wrap dc-input-area">
          <textarea className="dc-input" rows={3} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </span>
        <span className="dc-field-hint">
          {missing && !note.trim() ? <><Icon name="warning" />请写明终止的原因</> : '已查看可以不写；终止时写清原因'}
        </span>
      </label>
      <p className="dc-caption">{end ? end.caption : '这种提醒只能标为已查看。'}</p>
    </section>
  );
  return (
    <>
      <div className="dc-stack dc-enter">
        {wide ? <div className="dc-split">{shown}<div className="is-sticky">{work}</div></div> : <>{shown}{work}</>}
      </div>
      <div className="dc-actions is-row">
        {end && <button className="dc-btn dc-btn-ghost is-danger" type="button" disabled={busy} onClick={terminate}>终止</button>}
        <button className={`dc-btn dc-btn-primary ${busy && !confirming ? 'is-loading' : ''}`} type="button" disabled={busy} onClick={() => handle('seen')}>
          <Icon name="check" />已查看
        </button>
      </div>
      {confirming && end && (
        <ConfirmSheet title={end.title} text={end.text} confirm="确认终止" busy={busy} onConfirm={() => handle('terminate')} onClose={() => setConfirming(false)}>
          {end.list && <SheetList people={end.list} label="恢复的各项" />}
        </ConfirmSheet>
      )}
    </>
  );
}
