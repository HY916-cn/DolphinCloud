import type { ReactNode } from 'react';
import { renderDoc } from '@/lib/doc';
import { AppError, explain } from '@/lib/errors';
import { today } from './DatePicker';

// 批量管理 (PHASE-1.md §6.4): 选择 turns a list's rows into checkboxes; the bar under the list then acts on every
// picked row at once.
export function Pick({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="dc-check bt-pick">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="dc-check-box" />
      <span className="dc-sr-only">选择{label}</span>
    </label>
  );
}

export function BatchBar({ count, total, onAll, children }: { count: number; total: number; onAll: (on: boolean) => void; children: ReactNode }) {
  return (
    <div className="bt-bar" role="toolbar" aria-label="批量操作">
      <label className="dc-check">
        <input type="checkbox" checked={count > 0 && count === total} onChange={(e) => onAll(e.target.checked)} />
        <span className="dc-check-box" />
        <span>已选 {count} 个</span>
      </label>
      <span className="bt-bar-actions">{children}</span>
    </div>
  );
}

// Runs `fn` for each item in turn; one that fails does not stop the rest, and the result says which failed and why.
export async function eachOf<T, R>(items: T[], fn: (item: T) => Promise<R>) {
  const done: R[] = [];
  const failed: { item: T; title: string; text: string }[] = [];
  for (const item of items) {
    try {
      done.push(await fn(item));
    } catch (err) {
      failed.push({ item, ...(err instanceof AppError ? explain(err.code, err.detail) : explain('')) });
    }
  }
  return { done, failed };
}

// The new initial passwords of staff logins, to hand over: one row per login, signed for on receipt.
export type StaffPassword = { name: string; login_id: string; role: string; password: string };
export function passwordPages(rows: StaffPassword[]) {
  return renderDoc('工作人员账号初始密码', `打印于 ${today()}`, [
    { kind: 'heading', text: `${rows.length} 个账号`, sub: '首次登录后需要设置新密码（至少 8 位），初始密码随即失效。请本人签收，不要转告他人。' },
    { kind: 'table', head: ['姓名', '身份', '账号', '初始密码', '签收'], rows: rows.map((r) => [r.name, r.role, r.login_id, r.password, '']) },
    { kind: 'sign', labels: ['发放人签字', '日期'] },
  ]);
}
