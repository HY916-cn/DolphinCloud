import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { DatePicker, Desk, DutySheet, ForceSheet, Icon, ListLoading, Notice, ReviewSheet, ReviewTag, Toast, today } from '@/components';
import { diffAmount } from '@/lib/cash';
import type { CashReview, CashStatus } from '@/lib/duty';
import { dutySpan, formatAmount, reversedNote, shanghai } from '@/lib/format';
import { call } from '@/lib/rpc';
import { useMe } from '@/lib/session';

type Tab = 'waiting' | 'open' | 'forced' | 'done' | 'all';
const TABS: [Tab, string, CashStatus[]][] = [
  ['waiting', '待复核', ['pending', 'forced']], ['open', '待下班', ['open']], ['forced', '强制下班', ['forced']],
  ['done', '已轧账', ['done']], ['all', '全部', ['open', 'pending', 'forced', 'done']],
];
const htb = (n: number | null) => (n === null ? '—' : `${formatAmount(n)} HTB`);
const dayOf = (iso: string) => { const t = shanghai(new Date(iso)); return `${t.year}-${t.month.padStart(2, '0')}-${t.day.padStart(2, '0')}`; };

// 轧账 (PHASE-2.md §7, design system CashCount 后台“轧账”页; accountant, president, bank admin): every duty with what its
// cash box should hold, what the teller counted and the difference, newest first, by teller, day and status (待复核 by
// default). The teller's name opens the duty: the accountant reviews (复核) one that waits, the president and the bank
// admin end an open one (强制下班), anything else reads as a review. `?duty=<id>` opens that duty (from 总览).
export default function Cash() {
  const me = useMe().data!;
  const reviews = me.roles.includes('accountant');
  const forces = me.roles.includes('president') || me.roles.includes('teacher');
  const queryClient = useQueryClient();
  const { duty } = useLocalSearchParams<{ duty?: string }>();
  const [tab, setTab] = useState<Tab>('waiting');
  const [user, setUser] = useState('');
  const [day, setDay] = useState('');
  const [opened, setOpened] = useState<string | null>(duty ?? null);
  const [forcing, setForcing] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // shortcut: every duty in one read, filtered on the device; fine for one school's terms, pass p_from / p_to when it grows.
  const list = useQuery({ queryKey: ['cash-reviews'], queryFn: () => call<CashReview[]>('cash_reviews', {}) });
  const all = list.data ?? [];
  const tellers = [...new Map(all.map((r) => [r.user_id, r.name])).entries()];
  const found = all.filter((r) => (!user || r.user_id === user) && (!day || dayOf(r.started_at) === day));
  const shown = found.filter((r) => TABS.find(([k]) => k === tab)![2].includes(r.status));
  const open = all.find((r) => r.duty_id === opened);

  function done(r: CashReview, text: string) {
    queryClient.setQueryData<CashReview[]>(['cash-reviews'], (rows) => rows?.map((x) => (x.duty_id === r.duty_id ? r : x)));
    queryClient.invalidateQueries({ queryKey: ['cash-reviews'] });
    queryClient.invalidateQueries({ queryKey: ['cash-overview'] });
    setFresh(r.duty_id);
    setToast(text);
  }
  const close = () => {
    setOpened(null);
    setForcing(false);
    if (duty) router.setParams({ duty: undefined });
  };

  return (
    <Desk title="轧账">
      <div className="dc-stack dc-enter">
        <form className="dc-card dc-stack dc-filter" role="search" aria-label="筛选轧账" onSubmit={(e) => e.preventDefault()}>
          <div className="dc-filter-row">
            <label className="dc-field">
              <span className="dc-field-label"><Icon name="teller" />柜员</span>
              <span className="dc-select">
                <select value={user} onChange={(e) => setUser(e.target.value)}>
                  <option value="">全部柜员</option>
                  {tellers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </span>
            </label>
            <DatePicker label="日期" value={day} onChange={setDay} max={today()} rule="上班的日期，不能选今天以后" placeholder="不限" />
          </div>
        </form>
        <div className="dc-tabs" role="tablist" aria-label="轧账状态">
          {TABS.map(([k, label, statuses]) => (
            <button key={k} id={`cash-tab-${k}`} className="dc-tabs-item" role="tab" type="button" aria-selected={tab === k} aria-controls="cash-panel"
              onClick={() => setTab(k)}>{label}<span className="dc-count">{found.filter((r) => statuses.includes(r.status)).length}</span></button>
          ))}
        </div>
      </div>
      <section id="cash-panel" className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties} role="tabpanel" aria-labelledby={`cash-tab-${tab}`}>
        {list.isError ? <Notice tone="danger" title="暂时无法读取轧账">请检查网络后刷新页面。</Notice>
          : !list.data ? <ListLoading rows={4} label="正在加载轧账" />
          : !shown.length ? (
            <div className="dc-card dc-empty">
              <span className="dc-empty-icon"><Icon name="balance" /></span>
              <h3>{tab === 'waiting' ? '没有待复核的轧账' : '没有符合条件的上班记录'}</h3>
            </div>
          ) : (
            <div className="dc-card">
              <div className="dc-table-scroll">
                <table className="dc-table" aria-label="轧账">
                  <thead>
                    <tr>
                      <th scope="col">柜员</th><th scope="col">上班</th><th scope="col">状态</th><th scope="col" className="n">应有</th>
                      <th scope="col" className="n">柜员实点</th><th scope="col" className="n">差额</th><th scope="col">原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => {
                      const reversed = reversedNote(r.reversed, r.ended_at);
                      return (
                        <tr key={r.duty_id} className={fresh === r.duty_id ? 'is-new' : undefined}>
                          <td><a href="#" role="button" onClick={(e) => { e.preventDefault(); setOpened(r.duty_id); }}>{r.name}</a></td>
                          <td>{dutySpan(r.started_at, r.ended_at)}{reversed && <small className="dc-top-sub">{reversed}</small>}</td>
                          <td>
                            <ReviewTag r={r} />
                            {r.status === 'done' && r.forced_by && <small className="dc-top-sub">强制下班</small>}
                          </td>
                          <td className="n">{r.status === 'open' ? '—' : htb(r.expected_total)}</td>
                          <td className="n">{htb(r.teller_total)}</td>
                          <td className="n">{r.diff ? <span className={r.balanced ? undefined : 'is-danger'}>{diffAmount(r.diff)}</span> : '—'}</td>
                          <td className="is-wrap">
                            {r.teller_note}
                            {r.forced_reason && <small className="dc-top-sub">强制下班：{r.forced_reason}</small>}
                            {r.review_note && <small className="dc-top-sub">复核：财务点为 {htb(r.count_total)}，{r.review_note}</small>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
      </section>
      {open && (forcing ? (
        <ForceSheet r={open} onClose={close} onDone={(r) => { close(); done(r, '已强制下班'); }} />
      ) : forces && open.status === 'open' ? (
        <DutySheet r={open} onClose={close} onForce={() => setForcing(true)} />
      ) : (
        <ReviewSheet key={open.duty_id} r={open} canReview={reviews} onClose={close}
          onDone={(r) => { close(); done(r, `已复核，${r.balanced ? '平账' : diffAmount(r.diff!)}`); }} />
      ))}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </Desk>
  );
}
