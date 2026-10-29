import type { CSSProperties } from 'react';

// Skeletons (design system Skeleton): blocks the size of the real content, so nothing jumps when the data arrives.
// The wrapper says what is loading; the blocks are hidden from screen readers.
const Bone = ({ style, round }: { style: CSSProperties; round?: boolean }) => (
  <span className={`dc-skeleton ${round ? 'is-round' : ''}`} style={style} />
);
const lines = (title: string, sub: string) => (
  <span style={{ flex: 1, minWidth: 0 }}>
    <Bone style={{ width: title, height: 18 }} />
    <Bone style={{ width: sub, height: 14, marginTop: 8 }} />
  </span>
);

// ListGroup rows: round icon, name and one quiet line.
export function ListLoading({ rows = 4, label }: { rows?: number; label: string }) {
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
  return (
    <div className="dc-app" aria-busy="true" aria-label="正在加载">
      <div className="dc-shell" aria-hidden="true">
        <aside className="dc-nav">
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
          <header className="dc-top"><span className="dc-top-title">{lines('120px', '80px')}</span></header>
          <main className="dc-content">
            <Bone style={{ height: 184, borderRadius: 'var(--radius-lg)' }} />
            <Bone style={{ height: 240, borderRadius: 'var(--radius-lg)' }} />
          </main>
        </div>
      </div>
    </div>
  );
}
