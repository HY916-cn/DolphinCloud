import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Desk, Icon, KvLoading, link, ListLoading, Notice, Stats, StatsLoading, Summary, Toast, useCurrency, useCurrencyMoves, useWide,
} from '@/components';
import {
  htb, KINDS, monthDay, moveBy, moveTitle, net, notesText, outHtb, payoutLow, payoutText, ratioText, signed, signedHtb, type Overview,
} from '@/lib/currency';
import { formatAmount, formatTime } from '@/lib/format';
import { useMe } from '@/lib/session';

// 货币 (PHASE-2.md §11.2, design system Currency; accountant, president, bank admin): 兑付能力, the notes the bank should
// hold and where they went, the electronic money, and every record, newest first. Only the bank admin records (登记),
// on its own page; `?fresh=<id>` is the record just made, marked new with the Toast.
export default function Currency() {
  const me = useMe().data!;
  const admin = me.roles.includes('teacher');
  const wide = useWide();
  const overview = useCurrency();
  const moves = useCurrencyMoves();
  const params = useLocalSearchParams<{ fresh?: string }>();
  const [fresh] = useState(params.fresh ?? null);
  const [toast, setToast] = useState(!!params.fresh);
  useEffect(() => { if (params.fresh) router.setParams({ fresh: undefined }); }, [params.fresh]);
  const o = overview.data;
  const enter = <a className={`dc-btn dc-btn-primary ${wide ? 'dc-btn-sm' : ''}`} {...link('/admin/currency/new')}><Icon name="plus" />登记</a>;

  return (
    <Desk title="货币" actions={admin && wide ? enter : undefined}>
      {overview.isError ? (
        <Notice tone="danger" title="暂时无法读取货币数据">
          请检查网络后重试。
          <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={() => overview.refetch()}>重试</button>
        </Notice>
      ) : !o ? (
        <div className="dc-stack">
          <StatsLoading count={3} label="正在加载兑付能力" />
          <KvLoading rows={7} />
          <KvLoading rows={4} />
        </div>
      ) : <Figures o={o} admin={admin} />}

      <section className="dc-stack dc-enter" style={{ '--i': 3 } as React.CSSProperties} aria-label="登记记录">
        <h2 className="heading is-section">登记记录</h2>
        {moves.isError ? <Notice tone="danger" title="暂时无法读取登记记录">请检查网络后刷新页面。</Notice>
          : !moves.data ? <ListLoading rows={3} label="正在加载登记记录" />
          : !moves.data.length ? (
            <div className="dc-card dc-empty">
              <span className="dc-empty-icon"><Icon name="coin" /></span>
              <h3>还没有登记</h3>
            </div>
          ) : (
            <ul className="dc-list" aria-label="登记记录">
              {moves.data.map((m) => (
                <li key={m.id}>
                  <div className={`dc-list-item ${fresh === m.id ? 'is-new' : ''}`}>
                    <span className="dc-list-icon"><Icon name={KINDS[m.kind].icon} /></span>
                    <span>
                      {moveTitle(m, moves.data.find((t) => t.id === m.corrects))} · <b>{m.kind === 'correction' ? signedHtb(m.total) : htb(m.total)}</b>
                      <small>{monthDay(m.on_date)} · {notesText(m.denominations, m.kind === 'correction')}</small>
                      <small>{moveBy(m, formatTime(m.created_at))}</small>
                    </span>
                    {moves.data.some((c) => c.corrects === m.id) && <span className="dc-tag">有更正</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>
      {admin && !wide && <div className="dc-actions">{enter}</div>}
      {toast && <Toast text="已登记" onDone={() => setToast(false)} />}
    </Desk>
  );
}

// The figures of currency_overview: the notices, 兑付能力, 纸币 and 电子币.
function Figures({ o, admin }: { o: Overview; admin: boolean }) {
  const { paper, payout, electronic: e } = o;
  const counted = o.counted.boxes > 0;
  return (
    <>
      {!o.baseline && (
        <Notice icon="warning" title="先登记银行期初现金">
          {admin ? '登记金库和各储蓄盒现有的各面额张数，从登记那一刻起计算银行应有现金。现在按全部流水计算。' : '由银行管理员登记。现在按全部流水计算。'}
        </Notice>
      )}
      {payout.low && <Notice tone="danger" title={payoutLow(payout)}>{payoutText(paper.bank, e.total, payout)}</Notice>}
      <div className="dc-enter">
        <Stats items={[
          ['兑付能力', ratioText(payout.ratio).replace('%', ''), payout.ratio === null ? undefined : '%',
            payout.ratio === null ? '账户余额合计为 0' : payout.low ? `低于提示线 ${payout.min}%` : `提示线 ${payout.min}%`, payout.low],
          ['银行应有现金', net(paper.bank), 'HTB'],
          ['账户余额合计', formatAmount(e.total), 'HTB'],
        ]} />
      </div>

      <section className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties} aria-label="纸币">
        <h2 className="heading is-section">纸币</h2>
        <div className="dc-card dc-stack">
          <dl className="dc-kv">
            {([['期初现金', htb(paper.baseline)], ['发行', htb(paper.issued)], ['回收', outHtb(paper.recovered)], ['销毁', outHtb(paper.destroyed)],
              ['流水的现金变动', signedHtb(paper.flow)]] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            <div className="is-total"><dt>银行应有现金</dt><dd>{net(paper.bank)}<small>HTB</small></dd></div>
            <div><dt>流到学生手中</dt><dd>{signedHtb(paper.students)}</dd></div>
          </dl>
          {paper.students < 0 && <p className="dc-caption">学生把上线前就拿着的纸币存了进来。</p>}
          <div className="dc-table-scroll">
            <table className="dc-table" aria-label="按面额的纸币（张）">
              <thead>
                <tr>
                  {['面额（张）', '期初', '发行', '回收', '销毁', '流水', '银行应有', '储蓄盒实点', '流到学生手中'].map((h, i) => (
                    <th key={h} scope="col" className={i ? 'n' : undefined}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {o.notes.map((n) => (
                  <tr key={n.note}>
                    <td>{n.note} 元</td>
                    <td className="n">{net(n.baseline)}</td>
                    <td className="n">{net(n.issued)}</td>
                    <td className="n">{net(n.recovered)}</td>
                    <td className="n">{net(n.destroyed)}</td>
                    <td className="n">{signed(n.flow)}</td>
                    <td className="n">{net(n.bank)}</td>
                    <td className={`n ${n.counted !== null && n.counted !== n.bank ? 'is-danger' : ''}`}>{n.counted === null ? '—' : net(n.counted)}</td>
                    <td className="n">{signed(n.students)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>合计（HTB）</td>
                  <td className="n">{net(paper.baseline)}</td>
                  <td className="n">{net(paper.issued)}</td>
                  <td className="n">{net(paper.recovered)}</td>
                  <td className="n">{net(paper.destroyed)}</td>
                  <td className="n">{signed(paper.flow)}</td>
                  <td className="n">{net(paper.bank)}</td>
                  <td className="n">{counted ? net(o.counted.total) : '—'}</td>
                  <td className="n">{signed(paper.students)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="dc-caption">
            {counted ? `储蓄盒实点：${o.counted.boxes} 个储蓄盒最近一次轧账的实点，不含金库，最晚 ${formatTime(o.counted.at!)}。` : '还没有储蓄盒的实点。'}
          </p>
        </div>
      </section>

      <section className="dc-stack dc-enter" style={{ '--i': 2 } as React.CSSProperties} aria-label="电子币">
        <h2 className="heading is-section">电子币</h2>
        <div className="dc-split">
          <section className="dc-card dc-stack" aria-label="账户余额合计">
            <h3 className="heading">账户余额合计</h3>
            <Summary rows={[['活期', htb(e.current)], ['定期', htb(e.term)], ['理财本金', htb(e.wealth)]]} total={['账户余额合计', e.total]} />
          </section>
          <section className="dc-card dc-stack" aria-label="电子币新增">
            <h3 className="heading">电子币新增</h3>
            <p className="dc-caption">从登记期初现金起；没有登记时从头算。</p>
            <dl className="dc-kv">
              {([['工资', e.new.salary], ['利息', e.new.interest], ['理财盈亏', e.new.wealth], ['放款', e.new.loan], ['还款', -e.new.repay]] as const).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{signedHtb(v)}</dd></div>
              ))}
              <div className="is-total"><dt>电子币新增</dt><dd>{signed(e.new.total)}<small>HTB</small></dd></div>
            </dl>
          </section>
        </div>
      </section>
    </>
  );
}
