import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Notice } from './ui';

// Skeletons (design system Skeleton): blocks the size of the real content, so nothing jumps when the data arrives.
// The wrapper says what is loading; the blocks are hidden from screen readers.
const Bone = ({ style, round }: { style: CSSProperties; round?: boolean }) => (
  <span className={`dc-skeleton ${round ? 'is-round' : ''}`} style={style} />
);

// Still loading after 10 s: the skeleton gives way to a notice that says so (design system Skeleton). Inside a
// SkeletonGroup only the group gives way, so a page shows one notice.
const InGroup = createContext(false);
export function useSlow() {
  const grouped = useContext(InGroup);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, []);
  return slow && !grouped;
}
export const SlowNotice = () => <Notice title="加载时间比平时长">网络可能较慢，请稍候，或检查网络后刷新页面。</Notice>;
export function SkeletonGroup({ className, children }: { className: string; children: ReactNode }) {
  if (useSlow()) return <SlowNotice />;
  return <div className={className}><InGroup.Provider value>{children}</InGroup.Provider></div>;
}

const lines = (title: string, sub: string) => (
  <span style={{ flex: 1, minWidth: 0 }}>
    <Bone style={{ width: title, height: 18 }} />
    <Bone style={{ width: sub, height: 14, marginTop: 8 }} />
  </span>
);

// ListGroup rows: round icon, name and one quiet line.
export function ListLoading({ rows = 4, label }: { rows?: number; label: string }) {
  if (useSlow()) return <SlowNotice />;
  return (
    <ul className="dc-list" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} aria-hidden="true">
          <div className="dc-list-link">
            <Bone round style={{ width: 44, height: 44, flex: 'none' }} />
            {lines(`${40 + (i % 3) * 10}%`, '56%')}
          </div>
        </li>
      ))}
    </ul>
  );
}

// PersonCard: avatar, name and meta line, and the balance on the right when the card has one.
export function PersonLoading({ side }: { side?: boolean }) {
  if (useSlow()) return <SlowNotice />;
  return (
    <div className="dc-person" aria-busy="true" aria-label="正在加载">
      <span className="dc-person-avatar" aria-hidden="true"><Bone round style={{ width: 56, height: 56 }} /></span>
      <div className="dc-person-main" aria-hidden="true">{lines('40%', '70%')}</div>
      {side && <Bone style={{ width: 64, height: 32 }} />}
    </div>
  );
}

// SummaryList rows in a card.
export function KvLoading({ rows = 3, card = true }: { rows?: number; card?: boolean }) {
  if (useSlow()) return <SlowNotice />;
  const kv = (
    <dl className="dc-kv" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i}><Bone style={{ width: 64, height: 18 }} /><Bone style={{ width: `${24 + (i % 2) * 12}%`, height: 18 }} /></div>
      ))}
    </dl>
  );
  return card ? <div className="dc-card" aria-busy="true" aria-label="正在加载">{kv}</div> : <div aria-busy="true" aria-label="正在加载">{kv}</div>;
}

// A form card: field label and its 64px input, one per field.
export function FormLoading({ fields = 4 }: { fields?: number }) {
  if (useSlow()) return <SlowNotice />;
  return (
    <div className="dc-card dc-stack" aria-busy="true" aria-label="正在加载">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="dc-field" aria-hidden="true">
          <Bone style={{ width: 96, height: 20 }} />
          <Bone style={{ width: '100%', height: 64, borderRadius: 'var(--radius-md)' }} />
        </div>
      ))}
    </div>
  );
}

// ServiceTile grid (products at the counter).
export function TilesLoading({ count = 4 }: { count?: number }) {
  if (useSlow()) return <SlowNotice />;
  return (
    <div className="dc-tiles" aria-busy="true" aria-label="正在加载商品">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="dc-tile" aria-hidden="true">
          <Bone style={{ width: 80, height: 80, borderRadius: 'var(--radius-md)' }} />
          <Bone style={{ width: '60%', height: 18 }} />
        </div>
      ))}
    </div>
  );
}

// The app shell while the session and profile load: navigation column, title row and content blocks.
export function ShellLoading() {
  const slow = useSlow();
  return (
    <div className="dc-app" aria-busy={!slow} aria-label="正在加载">
      <div className="dc-shell">
        <aside className="dc-nav" aria-hidden="true">
          <div className="dc-nav-inner">
            <div className="dc-nav-brand"><img src="/logo.png" alt="" /><span>海豚云</span></div>
            <nav>
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="dc-nav-item"><Bone style={{ width: 28, height: 28, borderRadius: 'var(--radius-sm)' }} /><Bone style={{ width: 48, height: 18 }} /></div>
              ))}
            </nav>
          </div>
        </aside>
        <div className="dc-main">
          <header className="dc-top" aria-hidden="true"><span className="dc-top-title">{lines('120px', '80px')}</span></header>
          <main className="dc-content">
            {slow ? <SlowNotice /> : (
              <>
                <Bone style={{ height: 184, borderRadius: 'var(--radius-lg)' }} />
                <Bone style={{ height: 240, borderRadius: 'var(--radius-lg)' }} />
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
