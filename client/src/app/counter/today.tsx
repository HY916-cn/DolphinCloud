import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CounterPage, Icon, link, ListLoading, NeedsNetwork, Notice, ReversalSheet, Summary } from '@/components';
import { describeTxn, useMyDay, type DayTxn } from '@/lib/counter';
import { formatAmount, formatSigned, formatTime, signClass } from '@/lib/format';
import { useNewRows } from '@/lib/motion';
import { useOnline } from '@/lib/online';
import { useMe } from '@/lib/session';
import { KINDS } from '@/lib/txns';

const TOTALS = [['deposit', '存款'], ['withdraw', '取款'], ['purchase', '兑换']] as const;

// 今日业务 (PHASE-1.md §7.5, §6.3): what this teller has done today, the day's totals, and every line's next step:
// 冲正 it (one sheet: the reason and the confirmation) or serve that student again.
export default function Today() {
  const me = useMe().data!;
  const online = useOnline();
  const queryClient = useQueryClient();
  const day = useMyDay(me.profile.id, online);
  const [query, setQuery] = useState('');
  const [reversing, setReversing] = useState<DayTxn | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const all = day.data ?? [];
  const live = all.filter((t) => t.status === 'normal' && t.type !== 'reversal');
  const rows = TOTALS.map(([type, label]): [string, string] => {
    const of = live.filter((t) => t.type === type);
    return [label, `${of.length} 笔 · ${formatAmount(of.reduce((s, t) => s + t.amount, 0))} HTB`];
  });
  const q = query.trim().toUpperCase();
  const list = all.filter((t) => !q || t.txn_no.includes(q) || t.student_no.includes(q) || !!t.students?.name.includes(query.trim()));
  const fresh = useNewRows(day.data?.map((t) => t.id));
  const name = (t: DayTxn) => t.students?.name ?? `学号 ${t.student_no}`;

  if (!online) return <CounterPage title="今日业务"><NeedsNetwork business="冲正" /></CounterPage>;
  return (
    <CounterPage title="今日业务">
      {done && <Notice tone="success" title="冲正成功">{done}</Notice>}
      <div className="dc-split">
        <section className="dc-stack dc-enter" aria-label="今天我办理的业务">
          <label className="dc-search">
            <Icon name="query" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入姓名、学号或交易号" aria-label="查找业务" />
          </label>
          {day.error ? <Notice tone="danger" title="暂时无法读取今日业务">请检查网络后刷新页面。</Notice>
            : !day.data ? <ListLoading rows={3} label="正在加载今日业务" />
            : !list.length ? (
              <div className="dc-card">
                <div className="dc-empty">
                  <span className="dc-empty-icon"><Icon name="inbox" /></span>
                  <h3>{q ? '没有找到这笔业务' : '今天还没有办理业务'}</h3>
                  <p>{q ? '换个姓名、学号或交易号试试。' : '在「办理」里找到学生就可以开始。'}</p>
                  {!q && <a className="dc-btn dc-btn-primary dc-btn-sm" {...link('/counter')}>去办理</a>}
                </div>
              </div>
            ) : (
              <ul className="dc-txns">
                {list.map((t) => (
                  <li key={t.id} className={`dc-txn ${KINDS[t.type].kind} ${fresh.has(t.id) ? 'is-new' : ''}`} style={t.status === 'reversed' ? { opacity: 0.6 } : undefined}>
                    <span className="dc-txn-icon"><Icon name={KINDS[t.type].icon} /></span>
                    <div className="dc-txn-main">
                      <div className="dc-txn-title">{name(t)} · {describeTxn(t)}{t.status === 'reversed' && '（已冲正）'}</div>
                      <div className="dc-txn-time">{[t.txn_no, formatTime(t.created_at), t.reason && `原因：${t.reason}`].filter(Boolean).join(' · ')}</div>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
                        {t.status === 'normal' && t.type !== 'reversal' && t.type !== 'term_close' && t.type !== 'wealth_close' && (
                          <button className="dc-btn dc-btn-ghost dc-btn-sm dc-btn-inline" type="button" aria-label={`冲正 ${t.txn_no}`}
                            onClick={() => { setDone(null); setReversing(t); }}><Icon name="transfer" />冲正</button>
                        )}
                        <a className="dc-btn dc-btn-ghost dc-btn-sm dc-btn-inline" aria-label={`为${name(t)}继续办理`}
                          {...link(`/counter?s=${t.student_no}`)}><Icon name="coin" />继续办理</a>
                      </div>
                    </div>
                    <div className={`dc-txn-amount ${signClass(t.balance_delta)}`}>
                      {t.balance_delta ? formatSigned(t.balance_delta) : '现金'}<small>{t.balance_delta ? 'HTB' : `${t.amount} HTB`}</small>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </section>
        <aside className="dc-card is-sticky dc-enter" style={{ '--i': 1 } as React.CSSProperties} aria-label="今日合计">
          <h2 className="heading has-gap">今日合计</h2>
          <Summary rows={rows} />
        </aside>
      </div>
      {reversing && (
        <ReversalSheet txn={{ id: reversing.id, txn_no: reversing.txn_no, type: reversing.type, what: `${name(reversing)} · ${describeTxn(reversing)}` }}
          onClose={() => setReversing(null)}
          onDone={(r) => {
            setDone(`${name(reversing)} 的${describeTxn(reversing)}已冲正（${r.txn_no}），当前余额 ${formatAmount(r.balance_after)} HTB。`);
            setReversing(null);
            queryClient.invalidateQueries({ queryKey: ['my-day', me.profile.id] });
          }} />
      )}
    </CounterPage>
  );
}
