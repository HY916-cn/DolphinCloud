import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Desk, Icon, Notice, noticePages, OutputSheet, Summary, today, type NoticeAccount } from '@/components';
import { AppError, explain } from '@/lib/errors';
import { formatAmount } from '@/lib/format';
import { checkRoster, HEADER, type RosterProblem, type RosterRow } from '@/lib/roster';
import { call } from '@/lib/rpc';
import { supabase } from '@/lib/supabase';

type Stage =
  | { kind: 'pick'; error?: { title: string; text: string } }
  | { kind: 'checked'; file: string; rows: RosterRow[]; problems: RosterProblem[] }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'done'; created: NoticeAccount[]; updated: number };
type Imported = { created: number; updated: number; accounts: NoticeAccount[] };

const BATCH = 100;
const xlsx = () => import('xlsx'); // SheetJS loads only on this page

function downloadTemplate() {
  xlsx().then((X) => {
    const book = X.utils.book_new();
    X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([[...HEADER], ['20260101', '张小明', '小学部', 2023, 1, 120]]), '名册');
    X.writeFile(book, '海豚云名册导入模板.xlsx');
  });
}

// 导入名册 (PHASE-1.md §6.5): read the teacher's Excel, show every problem with its row, import in batches of 100,
// then print the account notices of the new students (or keep them as a PDF).
export default function ImportRoster() {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<Stage>({ kind: 'pick' });
  const [saving, setSaving] = useState(false);
  const promotion = useQuery({
    queryKey: ['setting', 'promotion_date'],
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('value').eq('key', 'promotion_date').single();
      if (error) throw error;
      return data.value as string;
    },
  });

  async function read(file: File) {
    try {
      const X = await xlsx();
      const sheet = X.read(await file.arrayBuffer()).Sheets;
      const first = Object.values(sheet)[0];
      const table = first ? X.utils.sheet_to_json<unknown[]>(first, { header: 1, defval: '' }) : [];
      setStage({ kind: 'checked', file: file.name, ...checkRoster(table, promotion.data ?? '09-01') });
    } catch {
      setStage({ kind: 'pick', error: { title: '读不出这个文件', text: '请选择 Excel（.xlsx、.xls）或 CSV 文件，并使用导入模板的格式。' } });
    }
  }

  async function run(rows: RosterRow[]) {
    const created: NoticeAccount[] = [];
    let updated = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      setStage({ kind: 'importing', done: i, total: rows.length });
      try {
        const r = await call<Imported>('import_roster', { p_rows: rows.slice(i, i + BATCH) }, 60_000);
        created.push(...r.accounts);
        updated += r.updated;
      } catch (err) {
        const e = err instanceof AppError ? err : new AppError('');
        const at = typeof e.detail.row === 'number' ? rows[i + e.detail.row - 1] : null;
        const { title, text } = explain(e.code, { ...e.detail, row: undefined });
        setStage({ kind: 'pick', error: { title, text: `${at ? `学号 ${at.student_no}：` : ''}${text}前 ${i} 人已导入；改好后重新导入整个名册即可，已导入的学号只会更新信息。` } });
        return;
      } finally {
        queryClient.invalidateQueries({ queryKey: ['admin-students'] });
        queryClient.invalidateQueries({ queryKey: ['roster'] }); // the counter on this device finds the new students at once
      }
    }
    setStage({ kind: 'done', created, updated });
  }

  return (
    <Desk title="导入名册" back={() => router.navigate('/admin/students')}>
      {stage.kind === 'pick' && (
        <div className="dc-split">
          <div className="dc-stack dc-enter">
            {stage.error && <Notice tone="danger" title={stage.error.title}>{stage.error.text}</Notice>}
            <label className="dc-tile" style={{ cursor: 'pointer' }}>
              <span className="dc-tile-icon"><Icon name="inbox" /></span>选择名册文件
              <small>Excel 或 CSV，第一行为表头</small>
              <input type="file" accept=".xlsx,.xls,.csv" aria-label="选择名册文件" hidden
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f); }} />
            </label>
          </div>
          <section className="dc-card dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties}>
            <h2 className="heading">导入模板</h2>
            <Summary rows={[
              ['学号', '必填，不能重复'], ['姓名', '必填'], ['学部', '小学部或初中部'],
              ['学届', '入学年份，如 2023'], ['班号', '1–99 的整数'], ['期初余额', '可空，非负整数'],
            ]} />
            <p className="dc-top-sub">已有的学号只更新姓名、学部、学届和班号，不改密码和余额。每个新学生有各自的初始密码，印在开户通知单上。</p>
            <button className="dc-btn dc-btn-secondary" type="button" onClick={downloadTemplate}>下载模板</button>
          </section>
        </div>
      )}

      {stage.kind === 'checked' && (stage.problems.length ? (
        <section className="dc-stack dc-enter">
          <Notice tone="danger" title={`名册有 ${stage.problems.length} 处需要修改`}>改好 {stage.file} 后重新选择文件。</Notice>
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
            <h2 className="heading">核对名册</h2>
            <Summary rows={[
              ['文件', stage.file],
              ['小学部', `${stage.rows.filter((r) => r.division === 'primary').length} 人`],
              ['初中部', `${stage.rows.filter((r) => r.division === 'junior').length} 人`],
              ['期初余额合计', `${formatAmount(stage.rows.reduce((s, r) => s + (r.opening_balance ?? 0), 0))} HTB`],
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
          <section className="dc-result">
            <span className="dc-result-badge dc-pop"><Icon name="success" /></span>
            <h1 className="display dc-enter" style={{ '--i': 1 } as React.CSSProperties}>导入完成</h1>
            <p className="dc-result-lead dc-enter" style={{ '--i': 2 } as React.CSSProperties}>
              新开户 <b>{stage.created.length}</b> 人，更新 <b>{stage.updated}</b> 人
            </p>
            {stage.created.length > 0 && (
              <p className="dc-top-sub dc-enter" style={{ '--i': 3 } as React.CSSProperties}>请打印开户通知单（每人一页），发给学生本人，提醒尽快登录并设置新密码。</p>
            )}
            <p className="dc-top-sub dc-enter" style={{ '--i': 4 } as React.CSSProperties}>回到学生页可打印期初余额核对表，与原账本逐人核对。</p>
          </section>
          <div className="dc-actions">
            <button className="dc-btn dc-btn-secondary" type="button" onClick={() => router.navigate('/admin/students')}>返回学生</button>
            {stage.created.length > 0 && (
              <button className="dc-btn dc-btn-primary" type="button" autoFocus onClick={() => setSaving(true)}>开户通知单</button>
            )}
          </div>
          {saving && (
            <OutputSheet title={`${stage.created.length} 份开户通知单`} name={`开户通知单-${today()}-${stage.created.length}人.pdf`}
              text="每人一页，打印后发给学生本人，提醒尽快登录并设置新密码。" make={() => noticePages(stage.created)} onClose={() => setSaving(false)} />
          )}
        </>
      )}
    </Desk>
  );
}
