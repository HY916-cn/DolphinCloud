import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Fullscreen, Icon } from '@/components';
import { boardView, clockFace, type Cell, type PublicRates } from '@/lib/public';
import { call } from '@/lib/rpc';

const Bone = () => <span className="dc-skeleton" style={{ width: '3.4em', height: '0.9em' }} />;
// What period a tile's numbers cover: 本周 (活期, 贷款, 定期) or 今天 (指数, 理财: the rates in force today).
const When = ({ children }: { children: string }) => <span className="dc-board-when">{children}</span>;
// A number with its % in small type; a skeleton before the first read.
const Num = ({ c }: { c?: Cell }) => (c ? <>{c.text}{c.pct && <small>%</small>}</> : <Bone />);
// One row of a list: the name, then the number, red or green when signed.
function Row({ name, c }: { name: ReactNode; c?: Cell }) {
  return <div><dt>{name}</dt><dd className={c?.trend ? `dc-pl ${c.trend}` : undefined}><Num c={c} /></dd></div>;
}
const rows = (n: number) => Array.from({ length: n }, (_, i) => <Row key={i} name={<Bone />} />);

// 利率看板 (/board, design system RateBoard): this week's rates and today's 理财 in five tiles on a big screen, no
// sign-in; read every 60 seconds, the last numbers kept while it cannot connect.
export default function Board() {
  const rates = useQuery({
    queryKey: ['public-rates'],
    queryFn: async () => boardView(await call<PublicRates>('public_rates', {})),
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
  const d = rates.data;
  const at = clockFace(rates.dataUpdatedAt).time;
  const status = !rates.isError ? (d ? `更新于 ${at}` : '') : d ? `暂时连不上，显示的是 ${at.slice(0, 5)} 的数据` : '暂时连不上';

  return (
    <div className="dc-board">
      <div className="dc-board-stage">
        <div className="dc-board-body">
          <header className="dc-board-head">
            <img src="/logo.png" alt="海豚云标志" />
            <h1 className="dc-board-title">海豚银行 · 利率<span className="dc-board-when">实时</span></h1>
            <span className={`dc-board-status ${rates.isError ? 'is-danger' : ''}`} role="status">
              {rates.isError && <Icon name="warning" />}{status}
            </span>
            <Fullscreen />
          </header>
          <div className="dc-board-grid" aria-busy={!d && !rates.isError}>
            {!d && rates.isError ? <p className="dc-board-wait">暂时连不上，正在重试</p> : (
              <>
                <section className="dc-board-panel is-current" aria-label="活期周利率">
                  <h2>活期<When>本周</When></h2>
                  <p className="dc-board-hero"><Num c={d?.current} /></p>
                </section>
                <section className="dc-board-panel is-loan" aria-label="贷款周利率">
                  <h2>贷款<When>本周</When></h2>
                  <dl className="dc-board-list is-grid">{d ? d.loans.map((l) => <Row key={l.label} name={l.label} c={l.cell} />) : rows(4)}</dl>
                </section>
                <section className="dc-board-panel is-term" aria-label="定期周利率">
                  <h2>定期<When>本周</When></h2>
                  <dl className="dc-board-list">{d ? d.terms.map((t) => <Row key={t.label} name={t.label} c={t.cell} />) : rows(5)}</dl>
                </section>
                <section className="dc-board-panel is-index" aria-label="参考指数涨跌">
                  <h2>指数<When>今天</When></h2>
                  <dl className="dc-board-list">{d ? <Row name={d.index.label} c={d.index.cell} /> : rows(1)}</dl>
                </section>
                <section className="dc-board-panel is-tiers" aria-label="理财各倍率的收益">
                  <h2>理财<When>今天</When></h2>
                  <dl className="dc-board-list">
                    {d ? d.tiers.map((t) => <Row key={t.key} name={<>{t.name}<small>×{t.multiplier}</small></>} c={t.cell} />) : rows(3)}
                  </dl>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
