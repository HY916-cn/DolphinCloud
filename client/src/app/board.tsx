import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Fullscreen, Icon } from '@/components';
import { boardView, clockFace, roll, type Cell, type PublicRates, type Roll } from '@/lib/public';
import { call } from '@/lib/rpc';

const Bone = () => <span className="dc-skeleton" aria-hidden />;
// What period a tile's numbers cover: 本周 (活期, 贷款, 定期) or 今天 (理财: each product's latest rate).
const When = ({ children }: { children: string }) => <span className="dc-board-when">{children}</span>;
// A number with its % in small type; a skeleton before the first read.
const Num = ({ c }: { c?: Cell }) => (c ? <>{c.text}{c.pct && <small>%</small>}</> : <Bone />);
// One row of a list: the name, then the number, red or green when signed.
function Row({ name, c }: { name: ReactNode; c?: Cell }) {
  return <div><dt>{name}</dt><dd className={c?.trend ? `dc-pl ${c.trend}` : undefined}><Num c={c} /></dd></div>;
}
const rows = (n: number) => Array.from({ length: n }, (_, i) => <Row key={i} name={<Bone />} />);
// 理财 before the first read: the six products.
const WEALTH_ROWS = 6;

// 自动滚动 (RateBoard): when the board is taller than the screen, scroll `board` down and back up in a loop, at 6 --u a
// second; anyone touching, clicking, wheeling or typing pauses it 30 s, and it goes on from there. It does not move
// with 减少动态效果. Reading the rates again does not restart it: it starts once, when `ready`.
function useAutoScroll(board: RefObject<HTMLDivElement | null>, ready: boolean) {
  useEffect(() => {
    const el = board.current;
    if (!ready || !el) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    let r: Roll = { phase: 'top', since: performance.now(), pos: 0 };
    let pausedUntil = 0;
    let frame = 0;
    const pause = () => { pausedUntil = performance.now() + 30_000; };
    const EVENTS = ['pointerdown', 'wheel', 'keydown', 'touchstart'] as const;
    EVENTS.forEach((e) => addEventListener(e, pause, { capture: true, passive: true }));
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (still.matches || now < pausedUntil) {
        // Afterwards it goes on down from wherever the board was left.
        r = { phase: 'top', since: now - 5_000, pos: el.scrollTop };
        return;
      }
      // --u is the gap of the board's body halved (calc(2 * var(--u))).
      const u = parseFloat(getComputedStyle(el.querySelector('.dc-board-body')!).rowGap) / 2;
      const next = roll(r, now, el.scrollHeight - el.clientHeight, 6 * u, el.scrollTop);
      if (next.phase === 'up' && r.phase !== 'up') el.scrollTo({ top: 0, behavior: 'smooth' });
      else if (next.phase === 'down' || (next.phase === 'bottom' && r.phase === 'down')) el.scrollTop = Math.round(next.pos);
      r = next;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      EVENTS.forEach((e) => removeEventListener(e, pause, { capture: true }));
    };
  }, [board, ready]);
}

// 利率看板 (/board, design system RateBoard): this week's rates and today's 理财 in four tiles on a big screen, no
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
  const board = useRef<HTMLDivElement>(null);
  useAutoScroll(board, !!d);

  return (
    <div className="dc-board" ref={board}>
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
          <div className={`dc-board-grid ${d?.flat ? 'is-flat-loan' : ''}`} aria-busy={!d && !rates.isError}>
            {!d && rates.isError ? <p className="dc-board-wait">暂时连不上，正在重试</p> : (
              <>
                <section className="dc-board-panel is-current" aria-label="活期周利率">
                  <h2>活期<When>本周</When></h2>
                  {d?.paused ? <p className="dc-board-hero is-paused">暂停计息</p> : <p className="dc-board-hero"><Num c={d?.current} /></p>}
                </section>
                <section className="dc-board-panel is-loan" aria-label="贷款周利率">
                  <h2>贷款<When>本周</When></h2>
                  {d?.flat ? <>
                    <p className="dc-board-hero"><Num c={d.loans[0]?.cell} /></p>
                    <p className="dc-board-note">信用分暂停，均按 600 分计</p>
                  </> : <dl className="dc-board-list is-grid">{d ? d.loans.map((l) => <Row key={l.label} name={l.label} c={l.cell} />) : rows(4)}</dl>}
                </section>
                <section className="dc-board-panel is-term" aria-label="定期周利率">
                  <h2>定期<When>本周</When></h2>
                  <dl className="dc-board-list">{d ? d.terms.map((t) => <Row key={t.label} name={t.label} c={t.cell} />) : rows(5)}</dl>
                </section>
                <section className="dc-board-panel is-wealth" aria-label="理财各品种今天的收益率">
                  <h2>理财<When>今天</When></h2>
                  <dl className="dc-board-list">
                    {d ? d.wealth.map((w) => <Row key={w.key} name={<>{w.name}{w.day && <small className="dc-board-day">{w.day}</small>}</>} c={w.cell} />)
                      : rows(WEALTH_ROWS)}
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
