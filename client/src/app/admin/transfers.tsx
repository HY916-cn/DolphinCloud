import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmSheet, Desk, Icon, ListLoading, Notice, Toast } from '@/components';
import { AppError, explain } from '@/lib/errors';
import { formatTime } from '@/lib/format';
import { formatSize } from '@/lib/public';
import { call } from '@/lib/rpc';

// list_transfers() (PHASE-2.md §15): the pickups not yet expired, newest first, without their codes.
type Pickup = { id: string; created_at: string; expires_at: string; total: number; files: { seq: number; name: string; size: number }[]; ip: string };
type List = { count: number; total: number; limit: number; transfers: Pickup[] };

// 文件传输 (bank admin, design system FileTransfer 后台): the pickups not yet expired, each deleted early with a reason.
export default function Transfers() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['transfers'], queryFn: () => call<List>('list_transfers', {}) });
  const [deleting, setDeleting] = useState<Pickup | null>(null);
  const [toast, setToast] = useState(false);
  const d = list.data;

  return (
    <Desk title="文件传输">
      {list.isError ? <Notice tone="danger" title="暂时无法读取文件传输">请检查网络后刷新页面。</Notice>
        : !d ? <ListLoading rows={3} label="正在加载文件传输" />
        : (
          <>
            <p className="dc-caption">未到期的取件 {d.count} 次，合计 {formatSize(d.total)}，上限 {formatSize(d.limit)}。</p>
            {!d.transfers.length ? (
              <div className="dc-card dc-empty">
                <span className="dc-empty-icon"><Icon name="file" /></span>
                <h3>没有未到期的取件</h3>
              </div>
            ) : (
              <ul className="dc-list" aria-label="未到期的取件">
                {d.transfers.map((t) => (
                  <li key={t.id}>
                    <div className="dc-list-item">
                      <span className="dc-list-icon"><Icon name="file" /></span>
                      <span>
                        {t.files.length} 个文件 · <b>{formatSize(t.total)}</b>
                        <small>{formatTime(t.created_at)} 生成 · {formatTime(t.expires_at)} 到期 · 来源 {t.ip}</small>
                        <small className="dc-file-name">{t.files.map((f) => f.name).join('、')}</small>
                      </span>
                      <button className="dc-btn dc-btn-ghost dc-btn-sm is-danger" type="button" onClick={() => setDeleting(t)}>删除</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      {deleting && (
        <DeleteSheet t={deleting} onClose={() => setDeleting(null)}
          onDone={(gone) => {
            queryClient.setQueryData<List>(['transfers'], (x) => x && { ...x, transfers: x.transfers.filter((p) => p.id !== gone) });
            queryClient.invalidateQueries({ queryKey: ['transfers'] });
            setDeleting(null);
            setToast(true);
          }} />
      )}
      {toast && <Toast text="已删除" onDone={() => setToast(false)} />}
    </Desk>
  );
}

// 删除: the reason is required, at most 200 characters; a refusal stays in the sheet, and a pickup already gone
// refreshes the list.
function DeleteSheet({ t, onClose, onDone }: { t: Pickup; onClose: () => void; onDone: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ title: string; text: string } | null>(null);
  const empty = !reason.trim();

  async function confirm() {
    setTried(true);
    if (empty || busy) return;
    setBusy(true);
    try {
      await call('delete_transfer', { p_id: t.id, p_reason: reason.trim() });
      onDone(t.id);
    } catch (e) {
      setProblem(explain(e instanceof AppError ? e.code : '', { ...(e instanceof AppError ? e.detail : {}), transfer: 'admin' }));
      if (e instanceof AppError && e.code === 'TRANSFER_NOT_FOUND') queryClient.invalidateQueries({ queryKey: ['transfers'] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmSheet title={`删除这 ${t.files.length} 个文件？`} text="删除后取件码立即失效，文件不能恢复。" confirm="确认删除" busy={busy}
      onConfirm={confirm} onClose={onClose}>
      <label className={`dc-field ${tried && empty ? 'is-error' : ''}`}>
        <span className="dc-field-label"><Icon name="help" />原因</span>
        <span className="dc-input-wrap dc-input-area">
          <textarea className="dc-input" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </span>
        {tried && empty && <span className="dc-field-hint"><Icon name="warning" />请写明删除的原因</span>}
      </label>
      {problem && <Notice tone="danger" title={problem.title}>{problem.text}</Notice>}
    </ConfirmSheet>
  );
}
