import { renderDoc, type Block } from '@/lib/doc';
import { formatAmount } from '@/lib/format';
import { A4, type PdfPage } from '@/lib/pdf';
import { icons, type IconName } from '@/theme/icons';
import { today } from './DatePicker';

export type NoticeStudent = { student_no: string; name: string; class_label: string | null; cohort: number; class_no: number };
// A student with the initial password the server gave them (import_roster, reissue_passwords, reset_password).
export type NoticeAccount = NoticeStudent & { password: string };

const classOf = (s: NoticeStudent) => s.class_label ?? `${s.cohort} 届 ${s.class_no} 班`;

// The students by class (newest cohort first), each class in student-number order.
function byClass<T extends NoticeStudent>(students: T[]) {
  const sorted = [...students].sort((a, b) => b.cohort - a.cohort || a.class_no - b.class_no || a.student_no.localeCompare(b.student_no));
  const classes = new Map<string, T[]>();
  for (const s of sorted) classes.set(classOf(s), [...(classes.get(classOf(s)) ?? []), s]);
  return [...classes];
}

// 期初余额核对表 (PHASE-1.md §12.1): one page per class, each student's opening balance in the system beside a blank
// column for the old ledger's balance, so the teacher checks them one by one and signs each class.
export function openingPages(students: NoticeStudent[], openings: Map<string, number>) {
  const date = today();
  return renderDoc('期初余额核对表', `打印于 ${date}`, byClass(students).flatMap(([label, list]): Block[] => [
    { kind: 'page' },
    { kind: 'heading', text: `${label} · ${list.length} 人`, sub: `系统期初余额合计 ${formatAmount(list.reduce((t, s) => t + (openings.get(s.student_no) ?? 0), 0))} HTB；逐人与原账本核对，一致的打勾。` },
    { kind: 'table', head: ['学号', '姓名', '系统期初余额', '原账本余额', '一致'],
      rows: list.map((s) => [s.student_no, s.name, openings.get(s.student_no) ?? 0, '', '']) },
    { kind: 'sign', labels: ['核对人签字', '日期'] },
  ]));
}

// The design system's wave (WaveDivider): one period of the curve, repeated across the width.
const WAVE = 'M0 12C40 0 80 0 120 12S200 24 240 12V24H0Z';

// 开户通知单 (PHASE-1.md §6.5), to print or keep as a PDF: one A4 page per student, by class. Each page is drawn on a canvas
// from the design system's parts, at their sizes and colours (1 CSS px = 1 pt): the LoginPage hero (logo with its
// rings, sea-soft → cloud-100, WaveDivider with a white shore), a display greeting, a dc-card with a SummaryList
// (class, number, the initial password as its total), Steps for signing in, and a Notice to keep the page safe.
export async function noticePages(students: NoticeAccount[]) {
  // shortcut: about 140 KB a page at 144 dpi (a 2000-student import is ~280 MB); split the download by class if that
  // becomes a problem.
  const scale = 2; // canvas pixels per point
  const W = A4.width;
  const X = 56; // page margin
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(A4.height * scale);
  const ctx = canvas.getContext('2d')!;
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(`--${name}`).trim();
  const family = v('font-sans') || 'sans-serif';
  const font = (weight: number, size: number) => `${weight} ${size}px ${family}`;
  const text = (value: string, x: number, y: number, weight: number, size: number, color: string, align: CanvasTextAlign = 'left') => {
    ctx.font = font(weight, size);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
    return ctx.measureText(value).width;
  };
  const block = (x: number, y: number, w: number, h: number, radius: number, fill: string, border?: string) => {
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, w - 2, h - 2, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 2; ctx.stroke(); }
  };
  // Lucide icons from the design system, stroked in one colour (README "图标").
  const icon = (name: IconName, color: string) => {
    const img = new Image();
    img.src = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" `
      + `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`);
    return img;
  };

  const date = new Date();
  const origin = window.__DOLPHIN_CONFIG__?.supabaseUrl ?? location.origin; // the site's public address, whatever this page was opened at
  const steps = [['打开网址', origin, ''], ['登录', '选「学生」', '输入学号和初始密码'], ['设新密码', '至少 8 位', '可以全是数字']];
  const words = ['海豚云明德实验学校海豚银行开户通知年月日同学，你好你的海豚银行账户已经开通，请按下面的步骤登录。登录信息班级学号初始密码怎样登录',
    '请妥善保管本通知单设置新密码后初始密码失效，不要把密码告诉他人。', ...steps.flat(),
    ...students.map((s) => s.name + classOf(s) + s.student_no + s.password)].join('');
  const logo = new Image();
  logo.src = '/logo.png';
  const lock = icon('lock', v('dolphin'));
  await Promise.all([...[800, 700, 600, 500, 400].map((w) => document.fonts.load(font(w, 16), words)),
    ...[logo, lock].map((img) => img.decode().catch(() => {}))]);

  const pages: PdfPage[] = [];
  for (const [label, list] of byClass(students)) {
    for (const s of list) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = v('surface-raised');
      ctx.fillRect(0, 0, W, A4.height);

      // LoginPage hero: sea-soft → cloud-100 at 160°, the logo in its rings, the name, then the waves.
      const hero = 200;
      const sky = ctx.createLinearGradient(W / 2 - 0.17 * hero, 0, W / 2 + 0.17 * hero, hero);
      sky.addColorStop(0, v('sea-soft'));
      sky.addColorStop(0.6, v('cloud-100'));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, hero);
      for (const [ring, alpha] of [[46, 0.16], [26, 0.32], [10, 0.6], [0, 1]] as const) {
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(W / 2, 58, 40 + ring, 0, Math.PI * 2);
        ctx.fill();
      }
      if (logo.naturalWidth) ctx.drawImage(logo, W / 2 - 38, 20, 76, 76);
      ctx.letterSpacing = '2.4px'; // .08em
      text('海豚云', W / 2, 132, 800, 30, v('ink'), 'center');
      ctx.letterSpacing = '0px';
      text(`明德实验学校海豚银行 · 开户通知 · ${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`, W / 2, 154, 600, 14, v('ink-muted'), 'center');
      // WaveDivider is-shore, 45 high: cloud-200, cloud-300, then white meeting the page.
      ([[45, 288, 16, 0, 'cloud-200'], [30, 224, 13, 88, 'cloud-300'], [16, 176, 10, 40, 'surface-raised']] as const)
        .forEach(([h, period, tile, shift, color]) => {
          const top = hero - h;
          ctx.fillStyle = v(color);
          for (let x = shift - period; x < W; x += period) {
            ctx.save();
            ctx.translate(x, top);
            ctx.scale(period / 240, tile / 24);
            ctx.fill(new Path2D(WAVE));
            ctx.restore();
          }
          ctx.fillRect(0, top + tile - 1, W, h - tile + 1);
        });

      text(`${s.name}同学，你好`, X, 252, 800, 36, v('ink'));
      text('你的海豚银行账户已经开通，请按下面的步骤登录。', X, 282, 400, 16, v('ink-muted'));

      // dc-card with a SummaryList; the initial password is its total row.
      block(X, 304, W - 2 * X, 250, 28, v('surface-raised'), v('line'));
      text('登录信息', X + 24, 349, 700, 20, v('ink'));
      ([['班级', label, 50], ['学号', s.student_no, 50], ['初始密码', s.password, 64]] as const).reduce((y, [key, value, h], i) => {
        const base = y + h / 2 + (i === 2 ? 12 : 5);
        text(key, X + 24, base, i === 2 ? 700 : 500, 16, i === 2 ? v('ink') : v('ink-muted'));
        text(value, W - X - 24, base, i === 2 ? 800 : 600, i === 2 ? 32 : 16, v('ink'), 'right');
        if (i < 2) {
          ctx.strokeStyle = v('line');
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(X + 24, y + h);
          ctx.lineTo(W - X - 24, y + h);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        return y + h;
      }, 366);

      // Steps: three dots joined by cloud-200 bars, each with its name and what to do.
      text('怎样登录', X, 596, 700, 20, v('ink'));
      const col = (W - 2 * X) / 3;
      steps.forEach(([name, ...lines], i) => {
        const cx = X + col * i + col / 2;
        if (i) block(cx - col + 28, 629, col - 56, 6, 3, v('cloud-200'));
        ctx.beginPath();
        ctx.arc(cx, 632, 18.5, 0, Math.PI * 2);
        ctx.fillStyle = v('surface-raised');
        ctx.fill();
        ctx.strokeStyle = v('line-strong');
        ctx.lineWidth = 3;
        ctx.stroke();
        text(String(i + 1), cx, 638, 700, 16, v('ink-muted'), 'center');
        text(name, cx, 676, 700, 14, v('ink'), 'center');
        lines.forEach((line, j) => line && text(line, cx, 696 + j * 20, 500, 14, v('ink-muted'), 'center'));
      });

      // Notice (default): cloud-100, line border, the lock icon, a title and one sentence.
      block(X, 740, W - 2 * X, 84, 20, v('cloud-100'), v('line'));
      if (lock.naturalWidth) ctx.drawImage(lock, X + 24, 756, 36, 36);
      text('请妥善保管本通知单', X + 72, 775, 700, 16, v('ink'));
      text('设置新密码后初始密码失效，不要把密码告诉他人。', X + 72, 801, 400, 16, v('ink'));

      const jpeg = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('canvas'))), 'image/jpeg', 0.8));
      pages.push({ jpeg: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height });
    }
  }

  return pages;
}
