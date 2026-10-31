import { createPortal } from 'react-dom';
import { formatAmount } from '@/lib/format';
import { A4, jpegPdf, type PdfPage } from '@/lib/pdf';
import { today } from './DatePicker';

export type NoticeStudent = { student_no: string; name: string; class_label: string | null; cohort: number; class_no: number };
// A student with the initial password the server gave them (import_roster, reissue_passwords).
export type NoticeAccount = NoticeStudent & { password: string };

// Print-only CSS: the page prints just the check sheet, one class per sheet.
const PRINT = `
@media screen { #dc-notices { display: none; } }
@media print {
  body > :not(#dc-notices) { display: none !important; }
  #dc-notices { font: 400 14px/1.6 var(--font-sans); color: #000; }
  #dc-notices section + section { break-before: page; }
  #dc-notices h2 { font-size: 16px; margin: 0 0 8px; }
  #dc-notices table { width: 100%; border-collapse: collapse; }
  #dc-notices th, #dc-notices td { border: 1px solid #666; padding: 4px 8px; text-align: left; }
  #dc-notices tr { break-inside: avoid; }
  #dc-notices .num { text-align: right; font-variant-numeric: tabular-nums; }
  #dc-notices footer { margin-top: 16px; display: flex; gap: 48px; }
}`;

const classOf = (s: NoticeStudent) => s.class_label ?? `${s.cohort} 届 ${s.class_no} 班`;

// The students by class (newest cohort first), each class in student-number order.
function byClass<T extends NoticeStudent>(students: T[]) {
  const sorted = [...students].sort((a, b) => b.cohort - a.cohort || a.class_no - b.class_no || a.student_no.localeCompare(b.student_no));
  const classes = new Map<string, T[]>();
  for (const s of sorted) classes.set(classOf(s), [...(classes.get(classOf(s)) ?? []), s]);
  return [...classes];
}

// 期初余额核对表 (PHASE-1.md §12.1): by class, each student's opening balance in the system beside a blank column for
// the old ledger's balance, so the teacher checks them one by one and signs each class.
export function OpeningSheet({ students, openings }: { students: NoticeStudent[]; openings: Map<string, number> }) {
  return createPortal(
    <div id="dc-notices">
      <style>{PRINT}</style>
      {byClass(students).map(([label, list]) => (
        <section key={label}>
          <h2>{label} · 期初余额核对表（{list.length} 人，合计 {formatAmount(list.reduce((t, s) => t + (openings.get(s.student_no) ?? 0), 0))} HTB）</h2>
          <table>
            <thead><tr><th>学号</th><th>姓名</th><th className="num">系统期初余额</th><th>原账本余额</th><th>一致</th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.student_no}>
                  <td>{s.student_no}</td><td>{s.name}</td><td className="num">{formatAmount(openings.get(s.student_no) ?? 0)}</td><td /><td />
                </tr>
              ))}
            </tbody>
          </table>
          <footer><span>核对人：</span><span>日期：</span></footer>
        </section>
      ))}
    </div>,
    document.body,
  );
}

// 开户通知单 (PHASE-1.md §6.5) as a PDF to download: one A4 page per student, by class: a branded header, a greeting,
// the student's name, class and number, their own initial password, how to sign in, and a reminder to keep it safe.
// Each page is drawn on a canvas in the app's own font and colours.
export async function downloadNotices(students: NoticeAccount[]) {
  // shortcut: about 140 KB a page at 144 dpi (a 2000-student import is ~280 MB); split the download by class if that
  // becomes a problem.
  const scale = 2; // canvas pixels per point
  const W = A4.width;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(A4.height * scale);
  const ctx = canvas.getContext('2d')!;
  const css = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const c = {
    dolphin: token('--dolphin', '#1f5ff5'), deep: token('--dolphin-deep', '#1546c4'), ink: token('--ink', '#13285c'),
    muted: token('--ink-muted', '#4a5b85'), surface: token('--surface', '#f4f7ff'), line: token('--line', '#d6e0fa'),
    cloud: token('--cloud-400', '#88a3e5'), cloudSoft: token('--cloud-100', '#e2e9fc'), coin: token('--coin', '#ffc233'),
    coinSoft: token('--coin-soft', '#fdefcf'), coinInk: token('--coin-ink', '#895700'), rose: token('--rose-soft', '#ffe6ef'),
    roseInk: token('--rose-ink', '#903c61'),
  };
  const family = token('--font-sans', 'sans-serif');
  const font = (weight: number, size: number) => `${weight} ${size}px ${family}`;
  const text = (value: string, x: number, y: number, weight: number, size: number, color: string, align: CanvasTextAlign = 'left') => {
    ctx.font = font(weight, size);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
    return ctx.measureText(value).width;
  };
  const box = (x: number, y: number, w: number, h: number, fill: string, stroke?: string) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 16);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  };

  const day = today();
  const origin = location.origin;
  const steps = ['用浏览器打开 ', '选「学生」，输入学号和上面的初始密码', '设置新密码：至少 8 位，同时包含字母和数字'];
  const notes = ['设置新密码后，本通知单上的初始密码即失效。', '请妥善保管本通知单，不要把密码告诉他人。'];
  const words = ['海豚云开户通知同学，你好！你的海豚银行账户已经开好，下面是登录需要的信息。姓名班级学号初始密码请在首次登录时修改怎样登录海豚银行',
    ...steps, ...notes, origin, day, ...students.map((s) => s.name + classOf(s) + s.student_no + s.password)].join('');
  const logo = new Image();
  logo.src = '/logo.png';
  await Promise.all([...[800, 700, 400].map((w) => document.fonts.load(font(w, 14), words)), logo.decode().catch(() => {})]);

  const pages: PdfPage[] = [];
  for (const [label, list] of byClass(students)) {
    for (const s of list) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, A4.height);

      // Header: the brand's blue with a scalloped cloud edge, as in the logo.
      const sky = ctx.createLinearGradient(0, 0, W, 200);
      sky.addColorStop(0, c.dolphin);
      sky.addColorStop(1, c.deep);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, 200);
      for (const [y, color, shift] of [[196, c.cloud, 0], [214, '#fff', 30]] as const) {
        ctx.fillStyle = color;
        for (let x = -60 + shift; x < W + 60; x += 60) { ctx.beginPath(); ctx.arc(x, y, 32, Math.PI, 0); ctx.fill(); }
        ctx.fillRect(0, y, W, 40);
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(96, 96, 40, 0, Math.PI * 2);
      ctx.fill();
      if (logo.naturalWidth) ctx.drawImage(logo, 62, 62, 68, 68);
      text('海豚云', 152, 84, 700, 18, c.cloudSoft);
      text('开户通知', 152, 124, 800, 36, '#fff');
      text(day, W - 56, 84, 400, 12, c.cloudSoft, 'right');
      text(label, W - 56, 104, 700, 14, '#fff', 'right');

      text(`${s.name}同学，你好！`, 56, 282, 800, 26, c.ink);
      text('你的海豚银行账户已经开好，下面是登录需要的信息。', 56, 308, 400, 13, c.muted);

      box(56, 330, W - 112, 92, c.surface, c.line);
      ([['姓名', s.name, 80], ['班级', label, 220], ['学号', s.student_no, 400]] as const).forEach(([key, value, x]) => {
        text(key, x, 362, 400, 12, c.muted);
        text(value, x, 394, 700, 19, c.ink);
      });

      box(56, 440, W - 112, 112, c.coinSoft, c.coin);
      text('初始密码', 80, 474, 700, 13, c.coinInk);
      ctx.letterSpacing = '8px';
      text(s.password, 78, 530, 800, 46, c.ink);
      ctx.letterSpacing = '0px';
      text('请在首次登录时修改', W - 80, 474, 400, 12, c.coinInk, 'right');

      text('怎样登录', 56, 598, 700, 16, c.ink);
      steps.forEach((step, i) => {
        const y = 636 + i * 36;
        ctx.fillStyle = c.dolphin;
        ctx.beginPath();
        ctx.arc(68, y - 5, 12, 0, Math.PI * 2);
        ctx.fill();
        text(String(i + 1), 68, y, 700, 13, '#fff', 'center');
        const w = text(step, 92, y, 400, 14, c.ink);
        if (!i) text(origin, 92 + w, y, 700, 14, c.dolphin);
      });

      box(56, 738, W - 112, 58, c.rose);
      notes.forEach((note, i) => text(note, 76, 762 + i * 20, 400, 12, c.roseInk));
      text('海豚银行', 56, 820, 700, 10, c.muted);
      text(`${label} · 学号 ${s.student_no}`, W - 56, 820, 400, 10, c.muted, 'right');

      const jpeg = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('canvas'))), 'image/jpeg', 0.8));
      pages.push({ jpeg: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height });
    }
  }

  const url = URL.createObjectURL(new Blob([jpegPdf(pages) as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `开户通知单-${today()}-${students.length}人.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
