import { formatAmount, niceMax } from './format';
import { A4, jpegPdf, type PdfPage } from './pdf';

// A printed document (报表, 下班总结, 账号通知单, 流水) drawn page by page on a canvas in the design system's type and
// colours, then saved as a PDF or printed. Blocks flow down the page; `page` starts a new one, and a table too long
// for its page continues on the next under its header again. Every page carries the document's title and its number.
type Cell = string | number | null;
export type Point = { label: string; value: number };
export type Block =
  | { kind: 'page' }
  | { kind: 'heading'; text: string; sub?: string }
  | { kind: 'text'; text: string }
  | { kind: 'stats'; items: [string, string][] }
  | { kind: 'table'; head: string[]; rows: Cell[][]; foot?: Cell[] }
  | { kind: 'columns' | 'line'; title: string; data: Point[]; unit: string; color?: string }
  | { kind: 'bars'; title: string; data: Point[]; unit: string; color?: string }
  | { kind: 'sign'; labels: string[] };

const SCALE = 2;
const W = A4.width;
const H = A4.height;
const X = 40;
const TOP = 72;
const BOTTOM = H - 48;
const ROW = 22;

const cellText = (c: Cell) => (c === null ? '—' : typeof c === 'number' ? `${c < 0 ? '−' : ''}${formatAmount(c)}` : c);

export async function renderDoc(title: string, sub: string, blocks: Block[]): Promise<PdfPage[]> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * SCALE);
  canvas.height = Math.round(H * SCALE);
  const ctx = canvas.getContext('2d')!;
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(`--${name}`).trim();
  const family = v('font-sans') || 'sans-serif';
  const font = (weight: number, size: number) => `${weight} ${size}px ${family}`;
  const words = [title, sub, ...blocks.flatMap((b) => Object.values(b).flat(3).map(String))].join('');
  await Promise.all([400, 600, 700, 800].map((w) => document.fonts.load(font(w, 12), words).catch(() => {})));

  const text = (value: string, x: number, y: number, weight: number, size: number, color: string, align: CanvasTextAlign = 'left', max?: number) => {
    ctx.font = font(weight, size);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let shown = value;
    if (max && ctx.measureText(shown).width > max) {
      while (shown && ctx.measureText(`${shown}…`).width > max) shown = shown.slice(0, -1);
      shown += '…';
    }
    ctx.fillText(shown, x, y);
  };
  const rule = (y: number, color = v('line'), width = 1) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(X, y);
    ctx.lineTo(W - X, y);
    ctx.stroke();
  };

  const pages: PdfPage[] = [];
  let y = 0;
  let open = false;
  const start = () => {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    text(title, X, 40, 800, 16, v('ink'));
    text(sub, W - X, 40, 500, 10, v('ink-muted'), 'right', W / 2);
    rule(50, v('ink'), 1.5);
    y = TOP;
    open = true;
  };
  const finish = async () => {
    if (!open) return;
    text(`第 ${pages.length + 1} 页`, W / 2, H - 24, 500, 9, v('ink-muted'), 'center');
    const jpeg = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('canvas'))), 'image/jpeg', 0.85));
    pages.push({ jpeg: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height });
    open = false;
  };
  const room = async (need: number) => {
    if (!open) start();
    else if (y + need > BOTTOM) { await finish(); start(); }
  };

  for (const b of blocks) {
    if (b.kind === 'page') { await finish(); continue; }
    if (b.kind === 'heading') {
      await room(48);
      text(b.text, X, y + 16, 800, 15, v('ink'));
      if (b.sub) text(b.sub, X, y + 34, 400, 10, v('ink-muted'), 'left', W - 2 * X);
      y += b.sub ? 48 : 30;
    } else if (b.kind === 'text') {
      await room(20);
      text(b.text, X, y + 11, 400, 10, v('ink-muted'), 'left', W - 2 * X);
      y += 20;
    } else if (b.kind === 'stats') {
      const per = Math.min(4, b.items.length);
      const w = (W - 2 * X - (per - 1) * 8) / per;
      for (let i = 0; i < b.items.length; i += per) {
        await room(58);
        b.items.slice(i, i + per).forEach(([label, value], j) => {
          const x = X + j * (w + 8);
          ctx.beginPath();
          ctx.roundRect(x, y, w, 50, 8);
          ctx.fillStyle = v('cloud-100');
          ctx.fill();
          text(label, x + 10, y + 18, 600, 9, v('ink-muted'), 'left', w - 20);
          text(value, x + 10, y + 39, 800, 15, v('ink'), 'left', w - 20);
        });
        y += 58;
      }
      y += 6;
    } else if (b.kind === 'table') {
      // Columns share the page's width by their longest text; numbers on the right.
      ctx.font = font(500, 9);
      const all = [b.head, ...b.rows.map((r) => r.map(cellText)), ...(b.foot ? [b.foot.map(cellText)] : [])];
      const natural = b.head.map((_, i) => Math.min(220, Math.max(...all.map((r) => ctx.measureText(String(r[i] ?? '')).width)) + 14));
      const total = natural.reduce((a, n) => a + n, 0);
      const widths = natural.map((n) => (n / total) * (W - 2 * X));
      const numeric = b.head.map((_, i) => b.rows.length > 0 && b.rows.every((r) => typeof r[i] !== 'string'));
      const line = (cells: Cell[] | string[], weight: number, color: string) => {
        let x = X;
        cells.forEach((c, i) => {
          const right = numeric[i] && i > 0;
          text(cellText(c as Cell), right ? x + widths[i] - 7 : x + 7, y + 15, weight, 9, color, right ? 'right' : 'left', widths[i] - 14);
          x += widths[i];
        });
      };
      const head = () => {
        ctx.fillStyle = v('cloud-100');
        ctx.fillRect(X, y, W - 2 * X, ROW);
        line(b.head, 700, v('ink'));
        y += ROW;
      };
      await room(ROW * 3);
      head();
      if (!b.rows.length) { text('（无）', X + 7, y + 15, 400, 9, v('ink-muted')); y += ROW; }
      for (const [i, r] of b.rows.entries()) {
        if (y + ROW > BOTTOM) { await finish(); start(); head(); }
        if (i % 2) { ctx.fillStyle = v('surface-sunken') || '#f6f8fc'; ctx.fillRect(X, y, W - 2 * X, ROW); }
        line(r, 500, v('ink'));
        y += ROW;
      }
      if (b.foot) {
        if (y + ROW > BOTTOM) { await finish(); start(); head(); }
        rule(y, v('ink'));
        line(b.foot, 800, v('ink'));
        y += ROW;
      }
      rule(y, v('line-strong'));
      y += 14;
    } else if (b.kind === 'sign') {
      await room(56);
      const w = (W - 2 * X) / b.labels.length;
      b.labels.forEach((label, i) => {
        text(`${label}：`, X + i * w, y + 30, 600, 11, v('ink'));
        ctx.strokeStyle = v('ink');
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(X + i * w + 60, y + 32);
        ctx.lineTo(X + (i + 1) * w - 16, y + 32);
        ctx.stroke();
      });
      y += 56;
    } else {
      // A chart: its title and highest value, a recessive grid, then columns, a line, or bars for named things.
      const color = v(b.color ?? 'dolphin'); // a design-system colour token
      const max = b.kind === 'bars' ? Math.max(1, ...b.data.map((d) => d.value)) : niceMax(Math.max(0, ...b.data.map((d) => d.value)));
      const height = b.kind === 'bars' ? 24 + Math.min(b.data.length, 16) * 18 : 190;
      await room(height + 16);
      text(b.title, X, y + 12, 700, 11, v('ink'));
      text(`合计 ${formatAmount(b.data.reduce((n, d) => n + d.value, 0))} ${b.unit} · 最高 ${formatAmount(Math.max(0, ...b.data.map((d) => d.value)))} ${b.unit}`, W - X, y + 12, 500, 9, v('ink-muted'), 'right');
      const top = y + 24;
      if (b.kind === 'bars') {
        const label = 110;
        b.data.slice(0, 16).forEach((d, i) => {
          const by = top + i * 18;
          text(d.label, X, by + 11, 500, 9, v('ink'), 'left', label - 8);
          const w = ((W - 2 * X - label - 70) * d.value) / max;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.roundRect(X + label, by + 2, Math.max(w, 1), 11, [0, 4, 4, 0]);
          ctx.fill();
          text(`${formatAmount(d.value)} ${b.unit}`, X + label + w + 6, by + 11, 600, 9, v('ink'));
        });
      } else {
        const plotH = 140;
        const plotW = W - 2 * X - 40;
        const left = X + 40;
        for (let g = 0; g <= 4; g++) {
          const gy = top + plotH - (plotH * g) / 4;
          ctx.strokeStyle = v('line');
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(left, gy);
          ctx.lineTo(left + plotW, gy);
          ctx.stroke();
          text(formatAmount(Math.round((max * g) / 4)), left - 6, gy + 3, 500, 8, v('ink-muted'), 'right');
        }
        const step = plotW / Math.max(b.data.length, 1);
        const every = Math.ceil(b.data.length / 10);
        b.data.forEach((d, i) => {
          if (i % every === 0) text(d.label, left + step * (i + 0.5), top + plotH + 14, 500, 8, v('ink-muted'), 'center');
        });
        if (b.kind === 'columns') {
          ctx.fillStyle = color;
          b.data.forEach((d, i) => {
            const h = (plotH * d.value) / max;
            ctx.beginPath();
            ctx.roundRect(left + step * i + step * 0.18, top + plotH - h, step * 0.64, Math.max(h, 0.5), [3, 3, 0, 0]);
            ctx.fill();
          });
        } else {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          b.data.forEach((d, i) => {
            const px = left + step * (i + 0.5);
            const py = top + plotH - (plotH * d.value) / max;
            if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
          });
          ctx.stroke();
        }
      }
      y += height + 16;
    }
  }
  await finish();
  return pages;
}

// 打印 or 下载 PDF: the pages as a file, or printed through a frame holding them as images, one per sheet of A4.
export function savePdf(pages: PdfPage[], name: string) {
  const url = URL.createObjectURL(new Blob([jpegPdf(pages) as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function printPages(pages: PdfPage[]) {
  const urls = pages.map((p) => URL.createObjectURL(new Blob([p.jpeg as BlobPart], { type: 'image/jpeg' })));
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><title>打印</title><style>@page{size:A4;margin:0}html,body{margin:0}img{display:block;width:210mm;height:297mm;break-after:page}</style>${
    urls.map((u) => `<img src="${u}">`).join('')}`);
  doc.close();
  await Promise.all([...doc.images].map((img) => img.decode().catch(() => {})));
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  // The dialog blocks until it closes in most browsers; the frame stays a while for the others.
  setTimeout(() => { frame.remove(); urls.forEach(URL.revokeObjectURL); }, 60_000);
}
