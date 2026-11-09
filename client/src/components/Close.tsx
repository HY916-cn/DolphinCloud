import { useState } from 'react';
import { AppError, explain } from '@/lib/errors';
import { formatAmount } from '@/lib/format';
import { call } from '@/lib/rpc';
import { ConfirmSheet, SheetList } from './Sheet';

export type Closing = { id: string; name: string; no: string; balance?: number | null };

// 注销 (PHASE-1.md §6.4): what closing does, then a second confirmation, since it cannot be undone. A student's balance
// is cleared by one 注销清零 transaction; the records stay.
export function CloseSheet({ people, onClose, onDone }: {
  people: Closing[]; onClose: () => void; onDone: (r: { tone: 'success' | 'danger'; title: string; text: string }) => void;
}) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const balance = people.reduce((s, p) => s + (p.balance ?? 0), 0);
  const who = people.length === 1 ? people[0].name : `${people[0].name} 等 ${people.length} 人`;
  const list = people.length > 1 && <SheetList people={people.map((p) => [p.name, p.no])} />;

  async function close() {
    setBusy(true);
    try {
      const r = await call<{ closed: number; cleared: number }>('close_accounts', { p_user_ids: people.map((p) => p.id) });
      onDone({ tone: 'success', title: `已注销 ${r.closed} 个账号`, text: r.cleared ? `余额共 ${formatAmount(r.cleared)} HTB 已清零。` : '' });
    } catch (err) {
      onDone({ tone: 'danger', ...(err instanceof AppError ? explain(err.code, err.detail) : explain('')) });
    } finally {
      setBusy(false);
    }
  }

  if (!sure) {
    return (
      <ConfirmSheet title={`注销${who}的账号？`} confirm="继续" onClose={onClose} onConfirm={() => setSure(true)}
        text={`注销后账号永久停用、不能恢复，也不再出现在名单里；交易、考勤和日志记录都保留。${balance ? `账户余额共 ${formatAmount(balance)} HTB 将清零。` : ''}`}>
        {list}
      </ConfirmSheet>
    );
  }
  return (
    <ConfirmSheet title="再次确认：注销后不能撤销" confirm="确认注销" busy={busy} onClose={onClose} onConfirm={close}
      text={`确定注销${people.length === 1 ? people[0].name : `这 ${people.length} 个账号`}？`}>
      {list}
    </ConfirmSheet>
  );
}
