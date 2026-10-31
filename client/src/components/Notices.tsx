import { createPortal } from 'react-dom';
import { formatAmount } from '@/lib/format';

export type NoticeStudent = { student_no: string; name: string; class_label: string | null; cohort: number; class_no: number };
// A student with the initial password the server gave them (import_roster, reissue_passwords).
export type NoticeAccount = NoticeStudent & { password: string };

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

// 开户通知单 (PHASE-1.md §6.5): by class, each with the name, class, number, own initial password and address.
// window.print() prints it.
export function AccountNotices({ students }: { students: NoticeAccount[] }) {
  return createPortal(
    <div id="dc-notices">
      <style>{PRINT}</style>
      {byClass(students).map(([label, list]) => (
        <section key={label}>
          <h2>{label} · 海豚云开户通知单（{list.length} 人）</h2>
          {list.map((s) => (
            <article key={s.student_no}>
              <b>海豚云开户通知</b>
              <dl>
                <dt>姓名</dt><dd>{s.name}</dd>
                <dt>班级</dt><dd>{label}</dd>
                <dt>学号</dt><dd>{s.student_no}</dd>
                <dt>初始密码</dt><dd>{s.password}</dd>
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
