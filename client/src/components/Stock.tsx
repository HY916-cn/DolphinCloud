import { formatSigned, formatTime } from '@/lib/format';
import { Icon, type IconName } from './ui';

export type Move = {
  id: number; kind: 'stock_in' | 'stock_out' | 'sale' | 'reversal'; qty_delta: number; note: string | null; created_at: string;
  products?: { name: string } | null;
};

const MOVE: Record<Move['kind'], { label: string; icon: IconName; kind: string }> = {
  stock_in: { label: '入库', icon: 'plus', kind: 'dc-kind-save' }, stock_out: { label: '出库', icon: 'minus', kind: 'dc-kind-withdraw' },
  sale: { label: '兑换', icon: 'exchange', kind: 'dc-kind-exchange' }, reversal: { label: '冲正', icon: 'transfer', kind: '' },
};

// Stock movements, newest first: what moved, the product when the list spans several, the note and the pieces.
export function MoveList({ moves, label }: { moves: Move[]; label: string }) {
  return (
    <ul className="dc-txns" aria-label={label}>
      {moves.map((m) => (
        <li key={m.id} className={`dc-txn ${MOVE[m.kind].kind}`}>
          <span className="dc-txn-icon"><Icon name={MOVE[m.kind].icon} /></span>
          <div className="dc-txn-main">
            <div className="dc-txn-title">{[MOVE[m.kind].label, m.products?.name, m.note].filter(Boolean).join(' · ')}</div>
            <div className="dc-txn-time">{formatTime(m.created_at)}</div>
          </div>
          <div className={`dc-txn-amount ${m.qty_delta > 0 ? 'is-in' : ''}`}>{formatSigned(m.qty_delta)}<small>件</small></div>
        </li>
      ))}
    </ul>
  );
}
