import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Icon, Notice, today, useInterest } from '@/components';
import { formatAmount, formatCenti, formatRate, formatSignedCenti } from '@/lib/format';
import { interestWeeks, pageRange, pendingParts, weekOf, type Accrual, type Adjustment, type InterestRow, type Settlement } from '@/lib/interest';
import { pendingNote } from '@/lib/rates';
import { useMe } from '@/lib/session';
import { monthDay } from '@/lib/term';
import { supabase } from '@/lib/supabase';

const DAYS = 'day,balance,rate,centi,settled_txn';
const ADJUSTMENTS = 'day,txn_id,balance,centi,settled_txn';
// One page of 4 weeks: the days from `from`, the corrections (first page), what paid them in, and whether older days exist.
type WeeksPage = { from: string; rows: Accrual[]; adjustments: Adjustment[]; settlements: Settlement[]; more: boolean };

// The 利息 businesses that paid the given rows in: how much each paid and when.
async function settlementsOf(rows: { settled_txn: string | null }[]) {
  const ids = [...new Set(rows.map((r) => r.settled_txn).filter((id): id is string => !!id))];
  if (!ids.length) return [];
  const { data, error } = await supabase.from('txns').select('id,amount,created_at').in('id', ids);
  if (error) throw error;
  return data as Settlement[];
}

// 利息 (/student/interest, design system StudentInterestPage): how much 活期 interest is saved up and when it is paid
// in, how it is worked out, and every day's interest by week, 4 weeks at a time. The card and the list read and fail
// on their own.
export default function StudentInterest() {
  const no = useMe().data!.student!.student_no;
  const thisWeek = weekOf(today());
  const interest = useInterest();
  // This week's days and the corrections not yet paid in, which add up to 攒着的利息 with the odd cents left over.
  const parts = useQuery({
    queryKey: ['interest', 'pending', no, thisWeek],
    queryFn: async () => {
      const [days, adjustments] = await Promise.all([
        supabase.from('interest_accruals').select(DAYS).eq('student_no', no).gte('day', thisWeek),
        supabase.from('interest_adjustments').select(ADJUSTMENTS).eq('student_no', no).is('settled_txn', null),
      ]);
      if (days.error) throw days.error;
      if (adjustments.error) throw adjustments.error;
      return { days: days.data as Accrual[], adjustments: adjustments.data as Adjustment[] };
    },
  });
  const weeks = useInfiniteQuery({
    queryKey: ['interest', 'weeks', no, thisWeek],
    initialPageParam: 0,
    getNextPageParam: (last: WeeksPage, pages) => (last.more ? pages.length : undefined),
    queryFn: async ({ pageParam }): Promise<WeeksPage> => {
      const { from, to } = pageRange(thisWeek, pageParam);
      let q = supabase.from('interest_accruals').select(DAYS).eq('student_no', no).gte('day', from);
      if (to) q = q.lt('day', to);
      const [days, older, adjustments] = await Promise.all([
        q.order('day', { ascending: false }),
        supabase.from('interest_accruals').select('day').eq('student_no', no).lt('day', from).limit(1),
        // Corrections are few: all of them with the first page, each listed once its week is.
        pageParam ? Promise.resolve({ data: [], error: null }) : supabase.from('interest_adjustments').select(ADJUSTMENTS).eq('student_no', no),
      ]);
      for (const r of [days, older, adjustments]) if (r.error) throw r.error;
      const rows = days.data as Accrual[];
      return {
        from, rows, adjustments: adjustments.data as Adjustment[], more: !!older.data?.length,
        settlements: await settlementsOf([...rows, ...(adjustments.data as Adjustment[])]),
      };
    },
  });
  const p = interest.data;
  const paused = p?.savings_enabled === false;
  const pages = weeks.data?.pages;
  const busy = interest.isPending || parts.isPending || weeks.isPending;

  return (
    <>
      <header className="dc-top">
        <button className="dc-icon-btn" type="button" aria-label="返回"
          onClick={() => (router.canGoBack() ? router.back() : router.replace('/student'))}><Icon name="back" /></button>
        <h1 className="dc-top-title title">利息</h1>
      </header>
      <main className="dc-content">
        <div className="dc-split" aria-busy={busy || undefined} aria-label={busy ? '正在加载利息' : undefined}>
          <div className="dc-stack">
            {weeks.isError && !pages ? <Failed title="暂时无法读取计息记录" onRetry={() => weeks.refetch()} />
              : !pages ? <WeeksLoading />
              : (() => {
                const list = interestWeeks(pages.flatMap((g) => g.rows), pages[0].adjustments, pages.flatMap((g) => g.settlements), thisWeek, pages.at(-1)!.from);
                if (!list.length && !weeks.hasNextPage) return <Empty paused={paused} />;
                return (
                  <>
                    {list.map((w) => (
                      <section key={w.monday}>
                        <div className="dc-list-head">
                          <h2 className="dc-list-title">{w.title}</h2>
                          <p className="dc-caption">{formatSignedCenti(w.total)} HTB · {w.paid === null ? '还攒着' : w.paid.amount === null ? `${monthDay(w.paid.day)}存进余额` : `已存进余额 ${formatAmount(w.paid.amount)} HTB`}</p>
                        </div>
                        <ul className="dc-list">{w.rows.map((r) => <li key={r.key}><Row r={r} /></li>)}</ul>
                      </section>
                    ))}
                    {weeks.isFetchNextPageError ? (
                      <div className="dc-load-more">
                        <p className="dc-caption is-danger">暂时无法读取更早的记录</p>
                        <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={() => weeks.fetchNextPage()}><Icon name="retry" />重试</button>
                      </div>
                    ) : weeks.hasNextPage && (
                      <div className="dc-load-more">
                        <button className={`dc-btn dc-btn-secondary dc-btn-sm ${weeks.isFetchingNextPage ? 'is-loading' : ''}`} type="button"
                          disabled={weeks.isFetchingNextPage} onClick={() => weeks.fetchNextPage()}>加载更多</button>
                      </div>
                    )}
                  </>
                );
              })()}
          </div>
          <div className="dc-stack is-sticky is-lead">
            {paused && (
              <Notice title="活期暂停计息" icon="rate">暂停期间每天不计利息。之前攒着的利息照常在周一存进余额。</Notice>
            )}
            {interest.isError || parts.isError
              ? <Failed title="暂时无法读取利息" onRetry={() => { interest.refetch(); parts.refetch(); }} />
              : !p || !parts.data ? <CardLoading /> : (() => {
                const s = pendingParts(p.pending_centi, parts.data.days, parts.data.adjustments, thisWeek);
                return (
                  <section className="dc-card dc-stack" aria-label="攒着的利息">
                    <p className="body-lg">攒着的利息</p>
                    <p className="amount">{formatCenti(p.pending_centi)}<small>HTB</small></p>
                    <p className="dc-caption">{pendingNote(p.pending_centi)}</p>
                    <dl className="dc-kv">
                      <div><dt>本周活期利率</dt><dd>{paused ? <span className="dc-tag">暂停计息</span> : `${formatRate(p.rates.current)}/周`}</dd></div>
                      <div><dt>本周已计</dt><dd>{formatSignedCenti(s.week)} HTB</dd></div>
                      {s.corrections !== null && <div><dt>利息更正</dt><dd>{formatSignedCenti(s.corrections)} HTB</dd></div>}
                      <div><dt>之前留下的零头</dt><dd>{formatCenti(s.carry)} HTB</dd></div>
                    </dl>
                  </section>
                );
              })()}
            <section className="dc-card dc-stack">
              <h2 className="heading">怎么计息</h2>
              <p className="dc-text">每天结束时，按当天结束时的活期余额计息：余额 × 活期周利率 ÷ 7，精确到 0.01 HTB。</p>
              <p className="dc-text">每周一把攒着的利息中满 1 HTB 的部分存进余额，记一笔“利息”，零头留到下周。</p>
              <p className="dc-caption">例：余额 415 HTB，周利率 2.13%，一天的利息是 1.26 HTB。</p>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}

// A day: its balance and rate (暂停计息 at 0); a correction: which day's interest and the corrected balance.
function Row({ r }: { r: InterestRow }) {
  return (
    <div className="dc-list-item is-amount">
      {r.kind === 'day'
        ? <span>{r.title}<small>余额 {formatAmount(r.balance)} HTB · {r.rate ? `${formatRate(r.rate)}/周` : '暂停计息'}</small></span>
        : <span>利息更正<small>{r.day}的利息 · 余额改为 {formatAmount(r.balance)} HTB</small></span>}
      <b>{formatSignedCenti(r.centi)} HTB</b>
    </div>
  );
}

function Failed({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <Notice tone="danger" title={title}>
      请稍后重试。
      <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={onRetry}><Icon name="retry" />重试</button>
    </Notice>
  );
}

function Empty({ paused }: { paused: boolean }) {
  return (
    <div className="dc-card dc-empty">
      <span className="dc-empty-icon dc-kind-reward"><Icon name="coin" /></span>
      <h3>还没有计息记录</h3>
      <p>{paused ? '活期暂停计息，恢复后每天结束时计一次利息。' : '每天结束时按活期余额计一次利息，明天就能在这里看到。'}</p>
    </div>
  );
}

// Skeletons (design system Skeleton): sizes on the blocks, as the other skeletons have them.
const Bone = ({ width, height = 18 }: { width: string | number; height?: number }) =>
  <span className="dc-skeleton" style={{ width, height }} />;

function CardLoading() {
  return (
    <section className="dc-card dc-stack" aria-hidden="true">
      <Bone width="40%" />
      <Bone width="50%" height={40} />
      <dl className="dc-kv">
        {[0, 1, 2].map((i) => <div key={i}><Bone width={96} /><Bone width={`${24 + (i % 2) * 12}%`} /></div>)}
      </dl>
    </section>
  );
}

function WeeksLoading() {
  return (
    <section aria-hidden="true">
      <div className="dc-list-head"><Bone width={80} /><Bone width={140} height={14} /></div>
      <ul className="dc-list">
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i}>
            <div className="dc-list-item is-amount">
              <span><Bone width={`${40 + (i % 3) * 10}%`} /><small><Bone width="56%" height={14} /></small></span>
              <Bone width={72} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
