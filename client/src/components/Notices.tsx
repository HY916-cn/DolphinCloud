import { createPortal } from 'react-dom';

export type NoticeStudent = { student_no: string; name: string; class_label: string | null; cohort: number; class_no: number };

// Print-only CSS: the page prints just the notices, one class per sheet, never splitting a notice.
const PRINT = `
@media screen { #dc-notices { display: none; } }
@media print {
  body > :not(#dc-notices) { display: none !important; }
  #dc-notices { font: 400 14px/1.6 var(--font-sans); color: #000; }
  #dc-notices section + section { break-before: page; }
  #dc-notices h2 { font-size: 16px; margin: 0 0 8px; }
  #dc-notices article { break-inside: avoid; border: 1px dashed #666; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; }
  #dc-notices dl { display: grid; grid-template-columns: 5em 1fr; margin: 6px 0; }
  #dc-notices dt, #dc-notices dd { margin: 0; }
  #dc-notices b { font-size: 16px; }
}`;

const classOf = (s: NoticeStudent) => s.class_label ?? `${s.cohort} 届 ${s.class_no} 班`;

// 开户通知单 (PHASE-1.md §6.5): by class, each with the name, class, number, default password and address. window.print() prints it.
export function AccountNotices({ students }: { students: NoticeStudent[] }) {
  const sorted = [...students].sort((a, b) => b.cohort - a.cohort || a.class_no - b.class_no || a.student_no.localeCompare(b.student_no));
  const classes = new Map<string, NoticeStudent[]>();
  for (const s of sorted) classes.set(classOf(s), [...(classes.get(classOf(s)) ?? []), s]);
  return createPortal(
    <div id="dc-notices">
      <style>{PRINT}</style>
      {[...classes].map(([label, list]) => (
        <section key={label}>
          <h2>{label} · 海豚云开户通知单（{list.length} 人）</h2>
          {list.map((s) => (
            <article key={s.student_no}>
              <b>海豚云开户通知</b>
              <dl>
                <dt>姓名</dt><dd>{s.name}</dd>
                <dt>班级</dt><dd>{label}</dd>
                <dt>学号</dt><dd>{s.student_no}</dd>
                <dt>初始密码</dt><dd>a12345678</dd>
                <dt>登录网址</dt><dd>{location.origin}</dd>
              </dl>
              用学号和初始密码登录，首次登录后请立即设置新密码。
            </article>
          ))}
        </section>
      ))}
    </div>,
    document.body,
  );
}
