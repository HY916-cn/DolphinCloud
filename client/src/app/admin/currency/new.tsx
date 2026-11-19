import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import {
  CashCounter, ConfirmSheet, DatePicker, Desk, FormLoading, Icon, Notice, Summary, today, useCurrency, useCurrencyMoves,
} from '@/components';
import { newId, useSettings } from '@/lib/counter';
import {
  CAPTIONS, confirmTitle, COUNT_MAX, countsOk, countsTotal, KINDS, monthDay, moveName, moveOption, net, notesText, signed, type Counts, type Kind,
} from '@/lib/currency';
import { AppError, explain } from '@/lib/errors';
import { call } from '@/lib/rpc';
import { useMe } from '@/lib/session';

type Field = 'on_date' | 'reason' | 'batch_no' | 'approver_name';
const FIELDS: Field[] = ['on_date', 'reason', 'batch_no', 'approver_name'];
type Problem = { title: string; text: string } | null;

// 登记货币 (PHASE-2.md §11.1, design system Currency), the bank admin's only: what kind, the counts of each note and what
// the kind asks for; a sheet lists it once more, then record_currency with the id made when the page opened, so a
// repeated submit records once. A refusal closes the sheet and keeps the form: a field's under that field, the rest above.
export default function NewCurrency() {
  const me = useMe().data!;
  if (!me.roles.includes('teacher')) return <Redirect href="/admin/currency" />;
  return (
    <Desk title="登记货币" back={() => router.navigate('/admin/currency')}>
      <CurrencyForm />
    </Desk>
  );
}

function CurrencyForm() {
  const queryClient = useQueryClient();
  const overview = useCurrency();
  const moves = useCurrencyMoves();
  const { denominations: faces } = useSettings();
  const [id] = useState(newId);
  const [chosen, setChosen] = useState<Kind | null>(null);
  const [counts, setCounts] = useState<Counts>({});
  const [corrects, setCorrects] = useState('');
  const [batch, setBatch] = useState('');
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');
  const [approver, setApprover] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [wrong, setWrong] = useState<Partial<Record<Field, string>>>({});

  if (overview.isError || moves.isError) {
    return (
      <Notice tone="danger" title="暂时无法读取货币数据">
        请检查网络后重试。
        <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={() => { overview.refetch(); moves.refetch(); }}>重试</button>
      </Notice>
    );
  }
  if (!overview.data || !moves.data) return <FormLoading fields={5} />;

  const based = !!overview.data.baseline;
  const kinds = (Object.keys(KINDS) as Kind[]).filter((k) => k !== 'baseline' || !based);
  const kind = chosen && kinds.includes(chosen) ? chosen : based ? 'issue' : 'baseline';
  const name = KINDS[kind].name;
  const reasonName = kind === 'issue' ? '用途' : '原因';
  const targets = moves.data.filter((m) => m.kind !== 'correction');
  const target = targets.find((m) => m.id === corrects);
  const values = Object.fromEntries(faces.map((f) => [f, counts[f] ?? 0]));
  const total = countsTotal(values);
  const ready = countsOk(kind, values)
    && (kind !== 'correction' || !!target)
    && (kind === 'correction' || !!date)
    && (kind === 'baseline' || !!reason.trim())
    && (kind !== 'issue' || (!!batch.trim() && !!approver.trim()));
  const totalText = kind === 'correction' ? signed(total) : net(total);
  const choose = (k: Kind) => { setChosen(k); setWrong({}); setProblem(null); };

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      await call('record_currency', {
        p_id: id, p_kind: kind, p_denominations: Object.fromEntries(Object.entries(values).filter(([, n]) => n !== 0)),
        p_on_date: kind === 'correction' ? null : date, p_reason: reason.trim() || null,
        p_batch_no: kind === 'issue' ? batch.trim() : null, p_approver_name: kind === 'issue' ? approver.trim() : null,
        p_corrects: kind === 'correction' ? corrects : null,
      });
      queryClient.invalidateQueries({ queryKey: ['currency'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      router.replace(`/admin/currency?fresh=${id}`);
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('');
      const said = explain(err.code, { ...err.detail, currency: kind, batch_no: batch.trim() });
      const field = String(err.detail.field);
      setConfirming(false);
      setBusy(false);
      if ((err.code === 'INVALID_INPUT' || err.code === 'ALREADY_EXISTS') && FIELDS.includes(field as Field)) {
        setWrong({ [field]: said.text });
        return;
      }
      // 期初现金 was recorded meanwhile: read again, so the kinds go on without it.
      if (err.code === 'ALREADY_EXISTS' && field === 'kind') {
        queryClient.invalidateQueries({ queryKey: ['currency'] });
        setChosen('issue');
      }
      setProblem(said);
    }
  }

  const text = (field: Field, label: string, icon: 'help' | 'coin' | 'teacher', value: string, set: (v: string) => void, max: number, area = false) => (
    <label className={`dc-field ${wrong[field] ? 'is-error' : ''}`}>
      <span className="dc-field-label"><Icon name={icon} />{label}</span>
      <span className={`dc-input-wrap ${area ? 'dc-input-area' : ''}`}>
        {area
          ? <textarea className="dc-input" rows={2} maxLength={max} value={value} onChange={(e) => { set(e.target.value); setWrong({ ...wrong, [field]: undefined }); }} />
          : <input className="dc-input" maxLength={max} value={value} onChange={(e) => { set(e.target.value); setWrong({ ...wrong, [field]: undefined }); }} />}
      </span>
      {wrong[field] && <span className="dc-field-hint"><Icon name="warning" />{wrong[field]}</span>}
    </label>
  );

  return (
    <form className="dc-stack dc-enter" noValidate aria-label="登记货币"
      onSubmit={(e) => { e.preventDefault(); if (ready) { setProblem(null); setWrong({}); setConfirming(true); } }}>
      {problem && <Notice tone="danger" title={problem.title}>{problem.text}</Notice>}
      <div className="dc-choices" role="radiogroup" aria-label="种类">
        {kinds.map((k) => (
          <label key={k} className="dc-choice">
            <input type="radio" name="currency-kind" checked={kind === k} onChange={() => choose(k)} />
            <span className="dc-choice-icon"><Icon name={KINDS[k].icon} /></span>
            <span><b>{KINDS[k].name}</b><small>{KINDS[k].note}</small></span>
          </label>
        ))}
      </div>

      <div className="dc-card dc-stack">
        {CAPTIONS[kind] && <p className="dc-caption">{CAPTIONS[kind]}</p>}
        {kind === 'correction' && (
          <label className="dc-field">
            <span className="dc-field-label"><Icon name="passbook" />对应的登记</span>
            <span className="dc-select">
              <select value={corrects} onChange={(e) => setCorrects(e.target.value)}>
                <option value="">请选择</option>
                {targets.map((m) => <option key={m.id} value={m.id}>{moveOption(m)}</option>)}
              </select>
            </span>
          </label>
        )}
        {kind === 'issue' && text('batch_no', '批次号', 'coin', batch, setBatch, 40)}
        {kind !== 'correction' && (
          <DatePicker label="日期" value={date} onChange={(d) => { setDate(d); setWrong({ ...wrong, on_date: undefined }); }} max={today()}
            rule="不能晚于今天" error={wrong.on_date} />
        )}
        <CashCounter faces={faces} counts={values} onChange={setCounts} kind="is-large"
          range={{ min: kind === 'correction' ? -COUNT_MAX : 0, max: COUNT_MAX }} />
        <Summary rows={[]} total={[`${name}合计`, total]} />
        {text('reason', reasonName, 'help', reason, setReason, 100, true)}
        {kind === 'issue' && text('approver_name', '审批人', 'teacher', approver, setApprover, 40)}
      </div>

      <div className="dc-actions is-row">
        <button className="dc-btn dc-btn-secondary dc-hide-phone" type="button" onClick={() => router.navigate('/admin/currency')}>取消</button>
        <button className="dc-btn dc-btn-primary" type="submit" disabled={!ready}><Icon name="check" />登记</button>
        <div className="dc-actions-total"><span>{name}</span><b>{totalText}<small>HTB</small></b></div>
      </div>

      {confirming && (
        <ConfirmSheet title={confirmTitle(kind, total, batch.trim())} confirm={busy ? '正在登记' : '确认登记'} busy={busy} onConfirm={submit}
          onClose={() => setConfirming(false)}>
          <Summary rows={[
            ['日期', monthDay(kind === 'correction' ? today() : date)],
            ['各面额', notesText(values, kind === 'correction')],
            ...(kind === 'issue' ? [['批次号', batch.trim()] as [string, string]] : []),
            ...(reason.trim() ? [[reasonName, reason.trim()] as [string, string]] : []),
            ...(kind === 'issue' ? [['审批人', approver.trim()] as [string, string]] : []),
            ...(target ? [['对应', moveName(target)] as [string, string]] : []),
          ]} />
          <p className="dc-sheet-text">登记后不能修改，登错了再登一笔更正。</p>
        </ConfirmSheet>
      )}
    </form>
  );
}
