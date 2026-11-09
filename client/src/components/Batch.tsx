import type { ReactNode } from 'react';
import { AppError, explain } from '@/lib/errors';

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
