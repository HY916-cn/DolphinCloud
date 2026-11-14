import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Desk, Icon, Notice, StaffNoticeSheet, Summary, type StaffNotice } from '@/components';
import { AppError, explain } from '@/lib/errors';
import { call } from '@/lib/rpc';
import { ROLES, type Role } from '@/lib/session';
import { loadStaffKnown } from '@/lib/staff';
import { checkStaff, STAFF_ROLES, type StaffProblem, type StaffRow } from '@/lib/staff-import';

type Failure = { title: string; text: string };
type Stage =
  | { kind: 'pick'; error?: Failure }
  | { kind: 'checked'; file: string; rows: StaffRow[]; problems: StaffProblem[] }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'done'; created: StaffNotice[]; updated: number; bound: number; error?: Failure };
type ImportedAccount = { login_id: string; name: string; role: Role; password: string; account: string | null; account_name: string | null };
type Imported = { created: number; updated: number; bound: number; accounts: ImportedAccount[] };

const BATCH = 100;
const xlsx = () => import('xlsx'); // SheetJS loads only on the import pages

function downloadTemplate() {
  xlsx().then((X) => {
    const book = X.utils.book_new();
    X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([['账号', '姓名', '身份', '工资账户'], ['teller02', '柜员小王', '柜员', '20260101'], ['store02', '库管小陈', '库管', '']]), '工作人员');
    X.writeFile(book, '海豚云工作人员导入模板.xlsx');
  });
}

// 导入工作人员 (PHASE-2.md §5.1): as 导入名册 — read the Excel, show every problem with its row, import in batches of 100,
// then print one notice per new login. The bank admin's and the sysadmin's bindings need no student password.
export default function ImportStaff() {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<Stage>({ kind: 'pick' });
  const [saving, setSaving] = useState(false);

  async function read(file: File) {
    let table: unknown[][];
    try {
      const X = await xlsx();
      const first = Object.values(X.read(await file.arrayBuffer()).Sheets)[0];
      table = first ? X.utils.sheet_to_json<unknown[]>(first, { header: 1, defval: '' }) : [];
    } catch {
      setStage({ kind: 'pick', error: { title: '读不出这个文件', text: '请选择 Excel（.xlsx、.xls）或 CSV 文件，并使用导入模板的格式。' } });
      return;
    }
    try {
      setStage({ kind: 'checked', file: file.name, ...checkStaff(table, await loadStaffKnown()) });
    } catch {
      setStage({ kind: 'pick', error: { title: '暂时无法核对', text: '读不到现有的账号和学生，请检查网络后重新选择文件。' } });
    }
  }

  async function run(rows: StaffRow[]) {
    const created: StaffNotice[] = [];
    let updated = 0;
    let bound = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      setStage({ kind: 'importing', done: i, total: rows.length });
      try {
        const r = await call<Imported>('import_staff', { p_rows: rows.slice(i, i + BATCH) }, 60_000);
        created.push(...r.accounts.map((a) => ({ ...a, role: ROLES[a.role], payroll: a.role !== 'sysadmin' })));
        updated += r.updated;
        bound += r.bound;
      } catch (err) {
        const e = err instanceof AppError ? err : new AppError('');
        const at = typeof e.detail.row === 'number' ? rows[i + e.detail.row - 1] : null;
        const { title, text } = explain(e.code, { ...e.detail, row: undefined });
        const error = { title, text: `${at ? `账号 ${at.login_id}：` : ''}${text}前 ${i} 人已导入；改好表格后再导入一次即可，已导入的账号只更新信息，不会重复创建账号。` };
        // Batches already imported have passwords shown nowhere else: keep their notices within reach.
        setStage(created.length ? { kind: 'done', created, updated, bound, error } : { kind: 'pick', error });
        return;
      } finally {
        queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
        queryClient.invalidateQueries({ queryKey: ['payroll'] });
      }
    }
    setStage({ kind: 'done', created, updated, bound });
  }

  return (
    <Desk title="导入工作人员" back={() => router.navigate('/admin/staff')}>
      {stage.kind === 'pick' && (
        <div className="dc-split">
          <div className="dc-stack dc-enter">
            {stage.error && <Notice tone="danger" title={stage.error.title}>{stage.error.text}</Notice>}
            <label className="dc-tile" style={{ cursor: 'pointer' }}>
              <span className="dc-tile-icon"><Icon name="inbox" /></span>选择工作人员表
              <small>Excel 或 CSV，第一行为表头</small>
              <input type="file" accept=".xlsx,.xls,.csv" aria-label="选择工作人员表" hidden
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f); }} />
            </label>
          </div>
          <section className="dc-card dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties}>
            <h2 className="heading">导入模板</h2>
            <Summary rows={[
              ['账号', '必填，2–32 位小写字母、数字、. _ -'], ['姓名', '必填'], ['身份', Object.keys(STAFF_ROLES).join('、')],
              ['工资账户', '可空，学号；运维员不填'],
            ]} />
            <p className="dc-top-sub">已有的账号只更新姓名和工资账户（留空表示不改），不改密码和身份。绑定工资账户不需要学生密码，每次绑定都记入日志。每个新账号有各自的初始密码，印在通知单上。</p>
            <button className="dc-btn dc-btn-secondary" type="button" onClick={downloadTemplate}>下载模板</button>
          </section>
        </div>
      )}

      {stage.kind === 'checked' && (stage.problems.length ? (
        <section className="dc-stack dc-enter">
          <Notice tone="danger" title={`表格有 ${stage.problems.length} 处需要修改`}>改好 {stage.file} 后重新选择文件。</Notice>
          <ul className="dc-list" aria-label="需要修改的地方">
            {stage.problems.slice(0, 50).map((p, i) => (
              <li key={i} className="dc-list-link"><span className="dc-list-icon"><Icon name="warning" /></span><span>第 {p.row} 行：{p.text}</span></li>
            ))}
          </ul>
          <div className="dc-actions">
            <button className="dc-btn dc-btn-primary" type="button" onClick={() => setStage({ kind: 'pick' })}>重新选择文件</button>
          </div>
        </section>
      ) : (
        <section className="dc-stack dc-enter">
          <div className="dc-card">
            <h2 className="heading">核对工作人员</h2>
            <Summary rows={[
              ['文件', stage.file],
              ...Object.entries(STAFF_ROLES).flatMap(([title, role]): [string, string][] => {
                const n = stage.rows.filter((r) => r.role === role).length;
                return n ? [[title, `${n} 人`]] : [];
              }),
              ['填了工资账户', `${stage.rows.filter((r) => r.account).length} 人`],
            ]} />
          </div>
          <div className="dc-actions">
            <button className="dc-btn dc-btn-secondary" type="button" onClick={() => setStage({ kind: 'pick' })}>重新选择</button>
            <span className="dc-actions-total">共 <b>{stage.rows.length}</b> 人</span>
            <button className="dc-btn dc-btn-primary" type="button" onClick={() => run(stage.rows)}>确认导入</button>
          </div>
        </section>
      ))}

      {stage.kind === 'importing' && (
        <div className="dc-card dc-progress dc-enter">
          <div className="dc-progress-head">正在导入<b>{stage.done} / {stage.total}</b></div>
          <div className="dc-progress-track" role="progressbar" aria-valuenow={stage.done} aria-valuemax={stage.total}>
            <div className="dc-progress-fill" style={{ '--value': stage.done / stage.total } as React.CSSProperties} />
          </div>
          <p className="dc-progress-note">请不要关闭页面。</p>
        </div>
      )}

      {stage.kind === 'done' && (
        <>
          {stage.error && <Notice tone="danger" title={stage.error.title}>{stage.error.text}</Notice>}
          <section className="dc-result">
            <span className="dc-result-badge dc-pop"><Icon name={stage.error ? 'warning' : 'success'} /></span>
            <h1 className="display dc-enter" style={{ '--i': 1 } as React.CSSProperties}>{stage.error ? '导入中断' : '导入完成'}</h1>
            <p className="dc-result-lead dc-enter" style={{ '--i': 2 } as React.CSSProperties}>
              新建 <b>{stage.created.length}</b> 人，更新 <b>{stage.updated}</b> 人，绑定工资账户 <b>{stage.bound}</b> 人
            </p>
            {stage.created.length > 0 && (
              <p className="dc-top-sub dc-enter" style={{ '--i': 3 } as React.CSSProperties}>请打印通知单（每人一页），发给本人。初始密码只在这里出现，离开页面后不能再看到。</p>
            )}
          </section>
          <div className="dc-actions">
            <button className="dc-btn dc-btn-secondary" type="button" onClick={() => router.navigate('/admin/staff')}>返回工作人员</button>
            {stage.created.length > 0 && (
              <button className="dc-btn dc-btn-primary" type="button" autoFocus onClick={() => setSaving(true)}>打印通知单</button>
            )}
          </div>
          {saving && <StaffNoticeSheet staff={stage.created} onClose={() => setSaving(false)} />}
        </>
      )}
    </Desk>
  );
}
