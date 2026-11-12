import { useState } from 'react';
import { newId, reverseTxn, type TxnResult } from '@/lib/counter';
import { useStaleRefusal } from '@/lib/duty';
import { AppError, explain } from '@/lib/errors';
import { ConfirmSheet } from './Sheet';
import { Icon, Notice } from './ui';

const REASONS = ['金额录错', '学号录错', '业务选错', '其他'];

// 冲正 one transaction (PHASE-1.md §6.3) from wherever it is listed: the reason, then one confirmation. The original
// stays and is marked 已冲正. `what` names the business for the teller ("张小明 · 存款 22 HTB"); `type` is the business's,
// so a refusal of a 定期 one says why.
export function ReversalSheet({ txn, onClose, onDone }: {
  txn: { id: string; txn_no: string; what: string; type?: string }; onClose: () => void; onDone: (r: TxnResult) => void;
}) {
  const [id] = useState(newId);
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const stale = useStaleRefusal();
  const full = reason === '其他' ? `其他：${other.trim()}` : reason;
  const ready = !!reason && (reason !== '其他' || !!other.trim());

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      onDone(await reverseTxn(id, txn.id, full));
    } catch (e) {
      stale(e);
      const err = e instanceof AppError ? e : new AppError('');
      setError(explain(err.code, { ...err.detail, type: txn.type }));
      setBusy(false);
    }
  }

  return (
    <ConfirmSheet title="冲正这笔业务？" confirm={busy ? '正在冲正' : '确认冲正'} ready={ready} busy={busy} onConfirm={submit} onClose={onClose}
      text={<><b>{txn.what}</b><br />交易号 {txn.txn_no}。冲正后余额和库存恢复，不能撤销。</>}>
      <fieldset className="dc-check-group">
        <legend>冲正原因</legend>
        {REASONS.map((r) => (
          <label key={r} className="dc-check">
            <input type="radio" name="reversal-reason" checked={reason === r} onChange={() => setReason(r)} />
            <span className="dc-radio-dot" />{r}
          </label>
        ))}
      </fieldset>
      {reason === '其他' && (
        <label className="dc-field">
          <span className="dc-field-label"><Icon name="help" />说明</span>
          <span className="dc-input-wrap">
            <input className="dc-input" autoFocus value={other} maxLength={60} placeholder="写清楚冲正的原因" onChange={(e) => setOther(e.target.value)} />
          </span>
        </label>
      )}
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
    </ConfirmSheet>
  );
}
