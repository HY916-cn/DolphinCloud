import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmSheet, CounterPage, Icon, NeedsNetwork, Notice, ResultView, Summary } from '@/components';
import { describeCash } from '@/lib/cash';
import { classOf, newId, reverseTxn, type TxnResult } from '@/lib/counter';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatTime } from '@/lib/format';
import { useOnline } from '@/lib/online';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type Txn = {
  id: string; txn_no: string; type: 'deposit' | 'withdraw' | 'purchase'; amount: number; payment: 'account' | 'cash' | null;
  denominations: Record<string, number> | null; created_at: string; student_no: string;
  students: { name: string; class_no: number; class_label: string | null };
  txn_items: { name: string; qty: number }[];
};
const KIND = { deposit: '存款', withdraw: '取款', purchase: '兑换' };
const REASONS = ['金额录错', '学号录错', '业务选错', '其他'];

const describe = (t: Txn) =>
  t.type === 'purchase' ? `兑换 ${t.txn_items.map((i) => `${i.name} × ${i.qty}`).join('、')}（${t.payment === 'cash' ? '现金' : '账户'}）`
  : `${KIND[t.type]} ${formatAmount(t.amount)} HTB`;

// 冲正 (PHASE-1.md §6.3, §7.5): pick one of today's own businesses (RLS shows a teller only those), give the reason,
// confirm. The original stays and is marked 已冲正.
export default function Reversal() {
  const me = useMe().data!;
  const online = useOnline();
  const today = useQuery({
    queryKey: ['my-txns-today', me.profile.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('txns')
        .select('id,txn_no,type,amount,payment,denominations,created_at,student_no,students(name,class_no,class_label),txn_items(name,qty)')
        .eq('operator_id', me.profile.id).eq('status', 'normal').in('type', ['deposit', 'withdraw', 'purchase'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as Txn[];
    },
  });
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Txn | null>(null);
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [id, setId] = useState(newId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const [done, setDone] = useState<TxnResult | null>(null);

  function reset() {
    setPicked(null);
    setReason('');
    setOther('');
    setId(newId());
    setError(null);
    setDone(null);
    today.refetch();
  }

  const fullReason = reason === '其他' ? `其他：${other.trim()}` : reason;
  async function submit() {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      setDone(await reverseTxn(id, picked!.id, fullReason));
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('');
      setError(explain(err.code, err.detail));
    } finally {
      setBusy(false);
    }
  }

  if (!online && !done) {
    return (
      <CounterPage title="冲正">
        <NeedsNetwork business="冲正" />
      </CounterPage>
    );
  }

  if (done && picked) {
    return (
      <CounterPage title="冲正">
        <ResultView title="冲正成功" next="返回列表" onNext={reset}
          lead={<>已冲正{describe(picked)}，当前余额 <b>{formatAmount(done.balance_after)}</b> HTB</>}
          rows={[
            ['学生', `${picked.students.name} · ${classOf(picked.students)}`],
            ['原业务', `${picked.txn_no} · ${formatTime(picked.created_at)}`],
            ['原因', fullReason],
            ['冲正时间', formatTime(done.created_at)],
            ['交易号', done.txn_no],
          ]} />
      </CounterPage>
    );
  }

  if (picked) {
    const ready = reason && (reason !== '其他' || other.trim());
    return (
      <CounterPage title="冲正" onBack={reset}>
        <div className="dc-split">
          <section className="dc-stack">
            <div className="dc-card dc-enter">
              <h2 className="heading" style={{ margin: '0 0 var(--space-2)' }}>要冲正的业务</h2>
              <Summary rows={[
                ['业务', describe(picked)],
                ['学生', `${picked.students.name} · ${classOf(picked.students)} · 学号 ${picked.student_no}`],
                ...(picked.denominations ? [[picked.type === 'purchase' ? '收到现金' : '面额', describeCash(picked.denominations)] as [string, string]] : []),
                ['办理时间', formatTime(picked.created_at)],
                ['交易号', picked.txn_no],
              ]} />
            </div>
          </section>
          <section className="dc-stack">
            <fieldset className="dc-check-group">
              <legend>冲正原因</legend>
              {REASONS.map((r) => (
                <label key={r} className="dc-check">
                  <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
                  <span className="dc-radio-dot" />{r}
                </label>
              ))}
            </fieldset>
            {reason === '其他' && (
              <label className="dc-field">
                <span className="dc-field-label"><Icon name="help" />说明</span>
                <span className="dc-input-wrap">
                  <input className="dc-input" autoFocus value={other} maxLength={60} placeholder="写清楚冲正的原因"
                    onChange={(e) => setOther(e.target.value)} />
                </span>
              </label>
            )}
          </section>
        </div>
        {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
        <div className="dc-actions">
          <button className="dc-btn dc-btn-secondary dc-hide-phone" type="button" onClick={reset}>上一步</button>
          <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button" disabled={!busy && !ready}
            onClick={() => setConfirming(true)}>
            {busy ? '正在冲正' : ready ? '确认冲正' : '请选择冲正原因'}
          </button>
        </div>
        {confirming && (
          <ConfirmSheet title="确认冲正" confirm="确认冲正" onClose={() => setConfirming(false)} onConfirm={submit}
            text={<>冲正 <b>{picked.students.name}</b> 的{describe(picked)}（{picked.txn_no}），原因：{fullReason}。冲正后不能撤销。</>} />
        )}
      </CounterPage>
    );
  }

  const list = (today.data ?? []).filter((t) => !search.trim() || t.txn_no.includes(search.trim().toUpperCase()) || t.student_no.includes(search.trim()));
  return (
    <CounterPage title="冲正">
      <label className="dc-search">
        <Icon name="query" />
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="输入交易号或学号" aria-label="查找业务" />
      </label>
      <div className="dc-section-head"><h2 className="heading">今天我办理的业务</h2></div>
      {today.error ? <Notice tone="danger" title="暂时无法读取业务">请检查网络后重试。</Notice>
        : !today.data ? null
        : list.length ? (
          <ul className="dc-list dc-stagger">
            {list.map((t) => (
              <li key={t.id}>
                <a className="dc-list-link" href="#" role="button" onClick={(e) => { e.preventDefault(); setPicked(t); }}>
                  <span className="dc-list-icon"><Icon name={t.type === 'purchase' ? 'exchange' : t.type} /></span>
                  <span>{t.students.name} · {describe(t)}<small className="dc-top-sub">{t.txn_no} · {formatTime(t.created_at)}</small></span>
                  <Icon name="next" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="dc-card">
            <div className="dc-empty">
              <span className="dc-empty-icon"><Icon name="inbox" /></span>
              <h3>{search.trim() ? '没有找到这笔业务' : '今天还没有可冲正的业务'}</h3>
              <p>只能冲正本人今天办理、还没冲正过的存款、取款和兑换。</p>
            </div>
          </div>
        )}
    </CounterPage>
  );
}
