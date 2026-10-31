import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { CashCounter, DatePicker, Desk, Icon, Notice, Summary, TxnListLoading, today, type IconName } from '@/components';
import { cashTotal, describeCash, nonEmpty, type Counts } from '@/lib/cash';
import { useSettings } from '@/lib/counter';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatTime } from '@/lib/format';
import { call } from '@/lib/rpc';
import { supabase } from '@/lib/supabase';

type Issue = {
  id: string; batch_no: string; issued_on: string; denominations: Counts; total: number; purpose: string; approver_name: string;
};
type Problem = { title: string; text: string } | null;

const failure = (e: unknown) => (e instanceof AppError ? explain(e.code, e.detail) : explain(''));
// "10月27日" (with the year when it is not this year) for a date column.
const formatDay = (date: string) => formatTime(`${date}T12:00:00+08:00`).split(' ')[0];

function Field({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <label className="dc-field">
      <span className="dc-field-label"><Icon name={icon} />{label}</span>
      <span className="dc-input-wrap">{children}</span>
    </label>
  );
}

// 发行 (teacher): register a batch of notes put into circulation, and every batch so far.
export default function Issues() {
  const issues = useQuery({
    queryKey: ['issues'],
    queryFn: async () => {
      const { data, error } = await supabase.from('currency_issues')
        .select('id,batch_no,issued_on,denominations,total,purpose,approver_name')
        .order('issued_on', { ascending: false }).order('created_at', { ascending: false });
      if (error) throw error;
      return data as Issue[];
    },
  });
  return (
    <Desk title="发行">
      <div className="dc-split">
        <IssueForm />
        <section className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties} aria-label="发行记录">
          <p className="dc-list-title">发行记录</p>
          {issues.error ? <Notice tone="danger" title="暂时无法读取发行记录">请检查网络后刷新页面。</Notice>
            : !issues.data ? <TxnListLoading />
            : issues.data.length ? (
              <ul className="dc-txns">
                {issues.data.map((i) => (
                  <li key={i.id} className="dc-txn dc-kind-reward">
                    <span className="dc-txn-icon"><Icon name="coin" /></span>
                    <div className="dc-txn-main">
                      <div className="dc-txn-title">{i.batch_no} · {i.purpose}</div>
                      <div className="dc-txn-time">{describeCash(i.denominations)}</div>
                      <div className="dc-txn-time">{formatDay(i.issued_on)} · 审批人 {i.approver_name}</div>
                    </div>
                    <div className="dc-txn-amount">{formatAmount(i.total)}<small>HTB</small></div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="dc-card">
                <div className="dc-empty">
                  <span className="dc-empty-icon dc-kind-reward"><Icon name="coin" /></span>
                  <h3>还没有发行记录</h3>
                  <p>每印发一批海豚币，在这里登记一次。</p>
                </div>
              </div>
            )}
        </section>
      </div>
    </Desk>
  );
}

function IssueForm() {
  const queryClient = useQueryClient();
  const faces = useSettings().denominations;
  const [batchNo, setBatchNo] = useState('');
  const [issuedOn, setIssuedOn] = useState(today);
  const [counts, setCounts] = useState<Counts>({});
  const [purpose, setPurpose] = useState('');
  const [approver, setApprover] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Problem>(null);
  const [done, setDone] = useState<Issue | null>(null);
  const total = cashTotal(counts);

  async function register(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const issue = await call<Issue>('register_issue', {
        p_batch_no: batchNo.trim(), p_issued_on: issuedOn || null, p_denominations: nonEmpty(counts),
        p_purpose: purpose.trim(), p_approver_name: approver.trim(),
      });
      setDone(issue);
      setBatchNo('');
      setCounts({});
      setPurpose('');
      setApprover('');
      queryClient.invalidateQueries({ queryKey: ['issues'] });
    } catch (err) {
      setError(failure(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="dc-card dc-stack dc-enter" onSubmit={register} noValidate aria-label="登记发行">
      <h2 className="heading">登记发行</h2>
      {done && <Notice tone="success" title="发行已登记">批次 {done.batch_no}，共 {formatAmount(done.total)} HTB。</Notice>}
      <Field icon="passbook" label="批次号">
        <input className="dc-input" value={batchNo} maxLength={40} placeholder="例如 2026-01" onChange={(e) => setBatchNo(e.target.value)} />
      </Field>
      <DatePicker label="发行日期" value={issuedOn} onChange={setIssuedOn} max={today()} rule="选这批钞票交给柜台的日期，不能晚于今天" />
      <div className="dc-field">
        <span className="dc-field-label"><Icon name="coin" />面额张数</span>
        <CashCounter faces={faces} counts={counts} onChange={setCounts} kind="dc-kind-reward" />
      </div>
      <Summary rows={[['面额', describeCash(counts) || '尚未填写']]} total={['发行总额', total]} />
      <Field icon="help" label="用途">
        <input className="dc-input" value={purpose} maxLength={60} placeholder="例如 秋季学期首批发行" onChange={(e) => setPurpose(e.target.value)} />
      </Field>
      <Field icon="teacher" label="审批人">
        <input className="dc-input" value={approver} maxLength={20} placeholder="审批人姓名" onChange={(e) => setApprover(e.target.value)} />
      </Field>
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="submit">{busy ? '正在登记' : '登记发行'}</button>
    </form>
  );
}
