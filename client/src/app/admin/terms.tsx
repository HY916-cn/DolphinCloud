import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmSheet, DatePicker, Desk, Icon, ListLoading, Notice, SheetList, today, type IconName } from '@/components';
import { AppError, explain } from '@/lib/errors';
import { call } from '@/lib/rpc';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { monthDay, openItem, termState, type Term, type TermState } from '@/lib/term';

const STATES: Record<TermState, { label: string; icon: IconName; tag: string }> = {
  upcoming: { label: '未开始', icon: 'calendar', tag: '' },
  current: { label: '进行中', icon: 'calendar', tag: '' },
  ended: { label: '已结束未结转', icon: 'clock', tag: 'dc-tag-pending' },
  closed: { label: '已结转', icon: 'success', tag: 'dc-tag-success' },
};
const FIELDS = ['name', 'starts_on', 'ends_on'];
const fullDate = (d: string) => `${d.slice(0, 4)}年${monthDay(d)}`;

type Step = { kind: 'edit'; term: Term | null } | { kind: 'close'; term: Term } | { kind: 'open'; term: Term; items: Record<string, unknown>[] };

// 学期 (PHASE-2.md §6, design system data.md 学期): every term, the latest first, with how it stands. The bank admin
// registers, changes and closes (结转) them; the president and the accountant only read them.
export default function Terms() {
  const me = useMe().data!;
  const editor = me.roles.includes('teacher');
  const now = today();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step | null>(null);
  const terms = useQuery({
    queryKey: ['terms'],
    queryFn: async () => {
      const { data, error } = await supabase.from('terms').select('id,name,starts_on,ends_on,closed_at').order('starts_on', { ascending: false });
      if (error) throw error;
      return data as Term[];
    },
  });
  const saved = () => { setStep(null); queryClient.invalidateQueries({ queryKey: ['terms'] }); };
  const add = (cls: string) => <button className={`dc-btn ${cls}`} type="button" onClick={() => setStep({ kind: 'edit', term: null })}><Icon name="plus" />登记学期</button>;
  const listed = editor && !!terms.data?.length;

  return (
    <Desk title="学期">
      {!editor && <p className="dc-top-sub">学期由银行管理员登记和结转</p>}
      {terms.isError ? <Notice tone="danger" title="暂时无法读取学期">请检查网络后刷新页面。</Notice>
        : !terms.data ? <ListLoading rows={3} label="正在加载学期" />
        : !terms.data.length ? (
          <div className="dc-empty dc-enter">
            <span className="dc-empty-icon"><Icon name="calendar" /></span>
            <h3>还没有登记学期</h3>
            <p>登记当前学期后，利息、贷款和定期才会开始。</p>
            {editor && add('dc-btn-secondary dc-btn-sm')}
          </div>
        ) : (
          <div className="dc-card dc-table-scroll dc-enter">
            <table className="dc-table" aria-label="学期">
              <thead>
                <tr>
                  <th scope="col">名称</th><th scope="col">开始日</th><th scope="col">结束日</th><th scope="col">状态</th>
                  {editor && <th scope="col">操作</th>}
                </tr>
              </thead>
              <tbody>
                {terms.data.map((t) => {
                  const state = termState(t, now);
                  const s = STATES[state];
                  return (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td>{fullDate(t.starts_on)}</td>
                      <td>{fullDate(t.ends_on)}</td>
                      <td><span className={`dc-tag ${s.tag}`}><Icon name={s.icon} />{s.label}</span></td>
                      {editor && (
                        <td>
                          {state !== 'closed' && (
                            <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                              <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={() => setStep({ kind: 'edit', term: t })}>修改</button>
                              {state === 'ended' && <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={() => setStep({ kind: 'close', term: t })}>结转</button>}
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      {listed && <div className="dc-actions">{add('dc-btn-primary')}</div>}

      {step?.kind === 'edit' && <TermSheet term={step.term} onClose={() => setStep(null)} onSaved={saved} />}
      {step?.kind === 'close' && <CloseTermSheet term={step.term} onClose={() => setStep(null)} onClosed={saved}
        onOpenItems={(items) => setStep({ kind: 'open', term: step.term, items })} />}
      {step?.kind === 'open' && (
        <ConfirmSheet title={explain('TERM_OPEN_ITEMS').title} text={explain('TERM_OPEN_ITEMS').text} confirm="知道了" cancel={null}
          onConfirm={() => setStep(null)} onClose={() => setStep(null)}>
          <SheetList label="还要处理的事项" people={step.items.map((i) => openItem(i, step.term.ends_on))} />
        </ConfirmSheet>
      )}
    </Desk>
  );
}

// 登记学期 / 修改学期. Days already past neither move into a term nor out of one (§6.1): a started term keeps its start,
// a past end stays; the calendars offer only the days the server takes.
function TermSheet({ term, onClose, onSaved }: { term: Term | null; onClose: () => void; onSaved: () => void }) {
  const now = today();
  const [name, setName] = useState(term?.name ?? '');
  const [starts, setStarts] = useState(term?.starts_on ?? now);
  const [ends, setEnds] = useState(term?.ends_on ?? now);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: string; text: string } | null>(null);
  const [notice, setNotice] = useState<{ title: string; text: string } | null>(null);
  const started = !!term && term.starts_on <= now;
  const errorOf = (field: string) => (fieldError?.field === field ? fieldError.text : undefined);

  async function save() {
    setBusy(true);
    setFieldError(null);
    setNotice(null);
    try {
      await call('upsert_term', { p_id: term?.id ?? null, p_name: name.trim(), p_starts: starts, p_ends: ends });
      onSaved();
    } catch (e) {
      const { code, detail } = e instanceof AppError ? e : new AppError('');
      const field = String(detail.field);
      if ((code === 'ALREADY_EXISTS' || code === 'INVALID_INPUT') && FIELDS.includes(field)) setFieldError({ field, text: explain(code, detail).text });
      else setNotice(explain(code, detail));
      setBusy(false);
    }
  }

  return (
    <ConfirmSheet title={term ? '修改学期' : '登记学期'} confirm="保存" busy={busy} ready={!!name.trim() && !!starts && ends >= starts}
      onConfirm={save} onClose={onClose}>
      <div className="dc-stack" style={{ marginTop: 'var(--space-3)' }}>
        {notice && <Notice tone="danger" title={notice.title}>{notice.text}</Notice>}
        <label className={`dc-field ${errorOf('name') ? 'is-error' : ''}`}>
          <span className="dc-field-label"><Icon name="passbook" />名称</span>
          <span className="dc-input-wrap"><input className="dc-input" value={name} placeholder="例如 2026 学年第一学期" onChange={(e) => setName(e.target.value)} /></span>
          {errorOf('name') && <span className="dc-field-hint"><Icon name="warning" />{errorOf('name')}</span>}
        </label>
        <DatePicker label="开始日" value={starts} error={errorOf('starts_on')}
          locked={started ? '学期已开始，开始日不能再改' : undefined}
          min={term ? now : undefined} rule={term ? '开始日不能早于今天' : ''}
          onChange={(d) => { setStarts(d); if (ends < d) setEnds(d); }} />
        <DatePicker label="结束日" value={ends} error={errorOf('ends_on')}
          locked={term && term.ends_on < now ? '结束日已过，不能再改' : undefined}
          min={started ? now : starts} rule={started ? '结束日不能早于今天' : '结束日不能早于开始日'}
          onChange={setEnds} />
      </div>
    </ConfirmSheet>
  );
}

// 结转 after a second look; what still holds the term open (TERM_OPEN_ITEMS) goes to its own list.
function CloseTermSheet({ term, onClose, onClosed, onOpenItems }: {
  term: Term; onClose: () => void; onClosed: () => void; onOpenItems: (items: Record<string, unknown>[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ title: string; text: string } | null>(null);
  async function close() {
    setBusy(true);
    setNotice(null);
    try {
      await call('close_term', { p_id: term.id });
      onClosed();
    } catch (e) {
      const { code, detail } = e instanceof AppError ? e : new AppError('');
      if (code === 'TERM_OPEN_ITEMS') return onOpenItems((detail.items as Record<string, unknown>[] | undefined) ?? []);
      setNotice(explain(code, detail));
      setBusy(false);
    }
  }
  return (
    <ConfirmSheet title={`结转 ${term.name}？`} text="结转后这个学期只读。余额和信用分原样转入下学期，不生成流水。" confirm="结转" busy={busy}
      onConfirm={close} onClose={onClose}>
      {notice && <div style={{ marginTop: 'var(--space-3)' }}><Notice tone="danger" title={notice.title}>{notice.text}</Notice></div>}
    </ConfirmSheet>
  );
}
