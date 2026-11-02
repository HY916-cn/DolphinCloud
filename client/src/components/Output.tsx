import { useState, type ReactNode } from 'react';
import { printPages, savePdf } from '@/lib/doc';
import { AppError, explain } from '@/lib/errors';
import type { PdfPage } from '@/lib/pdf';
import { ConfirmSheet } from './Sheet';
import { Notice } from './ui';

// Every printed document (PDF) is offered both ways: 打印 at once, or 下载 PDF to keep. `make` draws its pages; it
// may fail (the network), and then says why. `extra` goes under the text (another way on, such as 跳过打印).
export function OutputSheet({ title, text, name, make, onClose, onDone, extra }: {
  title: string; text: ReactNode; name: string; make: () => Promise<PdfPage[]>; onClose: () => void; onDone?: (how: 'print' | 'pdf') => void;
  extra?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ title: string; text: string } | null>(null);
  async function go(how: 'print' | 'pdf') {
    setBusy(true);
    setProblem(null);
    try {
      const pages = await make();
      if (how === 'pdf') savePdf(pages, name);
      else await printPages(pages);
      onDone?.(how);
    } catch (err) {
      setProblem(err instanceof AppError ? explain(err.code, err.detail) : { title: '文件未能生成', text: '请检查网络后再试一次。' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConfirmSheet title={title} text={text} confirm="打印" busy={busy} alt={{ label: '下载 PDF', onClick: () => go('pdf') }}
      onClose={onClose} onConfirm={() => go('print')}>
      {problem && <Notice tone="danger" title={problem.title}>{problem.text}</Notice>}
      {extra}
    </ConfirmSheet>
  );
}
