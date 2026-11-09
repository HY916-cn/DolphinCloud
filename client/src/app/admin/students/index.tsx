import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Avatar, BatchBar, CloseSheet, ConfirmSheet, Desk, eachOf, Icon, link, ListLoading, Notice, noticePages, openingPages, OutputSheet, Pick,
  ResetNoticeSheet, SheetList, today, type NoticeAccount,
} from '@/components';
import { classOf } from '@/lib/counter';
import { AppError, explain } from '@/lib/errors';
import { formatAmount } from '@/lib/format';
import { call } from '@/lib/rpc';
import { searchRoster } from '@/lib/search';
import { bankAdmin, managesLogins, useMe } from '@/lib/session';
import { STATUS, useStudents, type AdminStudent } from '@/lib/students';
import { readAll, supabase } from '@/lib/supabase';

const SHOWN = 100; // more with 「显示更多」
const BATCH = 100; // passwords are hashed one by one on the server, as in import_roster

type Status = 'normal' | 'frozen' | 'graduated';
const TO: Record<Status, string> = { frozen: '冻结', normal: '恢复正常', graduated: '标记毕业' };
type Result = { tone: 'success' | 'danger' | 'info'; title: string; text: string };
type Step = { kind: 'status'; to: Status } | { kind: 'reset' } | { kind: 'close' } | { kind: 'reissue' } | { kind: 'busy' }
  | { kind: 'notices'; accounts: NoticeAccount[]; resetAt?: Date } | { kind: 'opening' };

// 学生: find any student by name, pinyin, class or number, or only those who have not set a new password
// (?filter=waiting, linked from 总览); import the roster (teacher) and print the opening balance check sheet; print the
// notices of the students who have not signed in yet, with new initial passwords. 选择 acts on many students at once:
// freeze, restore or graduate them (teacher), reset their passwords, or close their accounts (注销).
export default function Students() {
  const me = useMe().data!;
  const students = useStudents();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const { filter } = useLocalSearchParams<{ filter?: string }>();
  const [onlyWaiting, setOnlyWaiting] = useState(filter === 'waiting');
  const [limit, setLimit] = useState(SHOWN);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<Step | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const all = useMemo(() => students.data?.rows ?? [], [students.data]);
  const waiting = all.filter((s) => s.profiles?.must_change_password);
  const list = useMemo(() => {
    const found = query.trim() ? searchRoster(students.data?.index ?? [], query, onlyWaiting ? all.length : limit) : all;
    return (onlyWaiting ? found.filter((s) => s.profiles?.must_change_password) : found).slice(0, limit);
  }, [students.data, all, query, onlyWaiting, limit]);
  const shown = onlyWaiting ? waiting : all;
  const teacher = me.roles.includes('teacher');
  const manages = managesLogins(me);
  const chosen = list.filter((s) => picked.has(s.student_no));
  const sheetRows = (rows: AdminStudent[]) => rows.map((s): [string, string] => [s.name, s.student_no]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-students'] });
  const notice = (s: AdminStudent, password: string): NoticeAccount =>
    ({ student_no: s.student_no, name: s.name, class_label: s.class_label, cohort: s.cohort, class_no: s.class_no, password });

  function done(r: Result) {
    setResult(r);
    setPicked(new Set());
    refresh();
  }
  const failures = (failed: { item: AdminStudent; title: string }[]) =>
    failed.map((f) => `${f.item.name}：${f.title}`).join('；');

  async function setStatus(to: Status) {
    setStep({ kind: 'busy' });
    const { done: ok, failed } = await eachOf(chosen.filter((s) => s.status !== to), (s) =>
      call('set_student_status', { p_student_no: s.student_no, p_status: to }));
    setStep(null);
    done(failed.length ? { tone: 'danger', title: `${failed.length} 人未能${TO[to]}`, text: failures(failed) }
      : { tone: 'success', title: `已${TO[to]} ${ok.length} 人`, text: '' });
  }

  // Students who set their own password meanwhile are skipped by the server, so fewer notices than `nos` is normal.
  async function reissue() {
    setStep({ kind: 'busy' });
    const nos = waiting.map((s) => s.student_no);
    const accounts: NoticeAccount[] = [];
    try {
      for (let i = 0; i < nos.length; i += BATCH) {
        accounts.push(...(await call<{ accounts: NoticeAccount[] }>('reissue_passwords', { p_student_nos: nos.slice(i, i + BATCH) }, 60_000)).accounts);
      }
    } catch (err) {
      const why = err instanceof AppError ? explain(err.code, err.detail) : explain('');
      // Passwords already reissued in earlier batches are still printed, so those notices are not lost.
      setResult({ tone: 'danger', title: why.title, text: why.text + (accounts.length ? `已为前 ${accounts.length} 人生成新密码。` : '') });
    }
    if (!nos.length) setResult({ tone: 'info', title: '没有需要重发通知单的学生', text: '名单里的学生都已设置新密码。' });
    refresh();
    setStep(accounts.length ? { kind: 'notices', accounts } : null);
  }

  async function reset() {
    setStep({ kind: 'busy' });
    const { done: accounts, failed } = await eachOf(chosen, async (s) =>
      notice(s, (await call<{ password: string }>('reset_password', { p_user_id: s.user_id })).password));
    if (failed.length) setResult({ tone: 'danger', title: `${failed.length} 人未能重置密码`, text: failures(failed) });
    setPicked(new Set());
    refresh();
    setStep(accounts.length ? { kind: 'notices', accounts, resetAt: new Date() } : null);
  }

  // Each student's 'opening' transaction (at most one, txns_one_opening); a student without one opened at 0.
  async function openings() {
    const rows = await readAll<{ student_no: string; amount: number }>((from, to) =>
      supabase.from('txns').select('student_no,amount').eq('type', 'opening').order('student_no').range(from, to));
    return openingPages(all, new Map(rows.map((r) => [r.student_no, r.amount])));
  }

  const busy = step?.kind === 'busy';
  return (
    <Desk title="学生">
      <form className="dc-card dc-stack dc-filter" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="dc-search">
          <Icon name="query" />
          <input type="search" aria-label="搜索学生" placeholder="输入姓名、拼音首字母、班级或学号" autoComplete="off"
            enterKeyHint="search" value={query} onChange={(e) => { setQuery(e.target.value); setPicked(new Set()); }} />
          {query && <button className="dc-search-clear" type="button" aria-label="清除" onClick={() => { setQuery(''); setPicked(new Set()); }}><Icon name="close" /></button>}
        </label>
        <div className="dc-filter-row">
          <div className="dc-chips" role="group" aria-label="筛选">
            <button className="dc-chip" type="button" aria-pressed={onlyWaiting} onClick={() => { setOnlyWaiting(!onlyWaiting); setPicked(new Set()); }}>
              <Icon name="check" />未设置密码{students.data && ` ${waiting.length}`}
            </button>
            {manages && all.length > 0 && (
              <button className="dc-chip" type="button" aria-pressed={picking} onClick={() => { setPicking(!picking); setPicked(new Set()); }}>
                <Icon name="check" />选择
              </button>
            )}
          </div>
          <span className="dc-filter-actions">
            {manages && waiting.length > 0 && (
              <button className={`dc-btn dc-btn-ghost dc-btn-sm ${busy ? 'is-loading' : ''}`} type="button" disabled={busy}
                onClick={() => setStep({ kind: 'reissue' })}>开户通知单</button>
            )}
            {bankAdmin(me) && all.length > 0 && <button className="dc-btn dc-btn-ghost dc-btn-sm" type="button" onClick={() => setStep({ kind: 'opening' })}>期初余额核对表</button>}
            {teacher && <a className="dc-btn dc-btn-secondary dc-btn-sm" {...link('/admin/students/import')}>导入名册</a>}
          </span>
        </div>
      </form>
      {students.isError && <Notice tone="danger" title="暂时无法读取名册">请检查网络后刷新页面。</Notice>}
      {result && <Notice tone={result.tone} title={result.title}>{result.text}</Notice>}
      <p className="dc-top-sub">{students.data && <>共 {all.length} 名学生{waiting.length > 0 && `，${waiting.length} 人还未设置新密码`}</>}</p>
      {students.isPending ? <ListLoading rows={6} label="正在加载学生" />
        : list.length ? (
          <ul className="dc-list" aria-label="学生">
            {list.map((s) => (
              <Row key={s.student_no} s={s} pick={picking ? (
                <Pick label={s.name} checked={picked.has(s.student_no)} onChange={(on) => {
                  const next = new Set(picked);
                  if (on) next.add(s.student_no); else next.delete(s.student_no);
                  setPicked(next);
                }} />
              ) : null} />
            ))}
          </ul>
        ) : students.data && (
          <div className="dc-empty">
            <span className="dc-empty-icon"><Icon name={query ? 'query' : 'me'} /></span>
            <h3>{query ? `没有找到「${query.trim()}」` : onlyWaiting ? '所有学生都已设置新密码' : '还没有学生'}</h3>
            <p>{query ? '换个写法试试：姓名、拼音首字母、班级或学号。' : onlyWaiting ? '取消「未设置密码」筛选可以查看全部学生。' : '导入名册后，这里会列出全部学生。'}</p>
          </div>
        )}
      {!query && shown.length > limit && (
        <button className="dc-btn dc-btn-secondary dc-btn-block" type="button" onClick={() => setLimit(limit + SHOWN)}>
          显示更多（已显示 {limit} / {shown.length} 人）
        </button>
      )}
      {picking && (
        <BatchBar count={chosen.length} total={list.length}
          onAll={(on) => setPicked(on ? new Set(list.map((s) => s.student_no)) : new Set())}>
          {teacher && (Object.keys(TO) as Status[]).map((to) => (
            <button key={to} className={`dc-btn dc-btn-sm ${to === 'normal' ? 'dc-btn-secondary' : 'dc-btn-ghost is-danger'}`} type="button"
              disabled={!chosen.some((s) => s.status !== to) || busy} onClick={() => setStep({ kind: 'status', to })}>{TO[to]}</button>
          ))}
          <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" disabled={!chosen.length || busy} onClick={() => setStep({ kind: 'reset' })}>重置密码</button>
          <button className="dc-btn dc-btn-ghost dc-btn-sm is-danger" type="button" disabled={!chosen.length || busy} onClick={() => setStep({ kind: 'close' })}>注销</button>
        </BatchBar>
      )}

      {step?.kind === 'status' && (
        <ConfirmSheet title={`${TO[step.to]} ${chosen.filter((s) => s.status !== step.to).length} 名学生？`} confirm={TO[step.to]}
          onClose={() => setStep(null)} onConfirm={() => setStatus(step.to)}
          text={step.to === 'normal' ? '恢复后可以在柜台办理业务。' : `${step.to === 'frozen' ? '冻结' : '毕业'}后柜台不能为他们办理业务，余额和记录保留，可以再恢复。`}>
          <SheetList people={sheetRows(chosen.filter((s) => s.status !== step.to))} />
        </ConfirmSheet>
      )}
      {step?.kind === 'reset' && (
        <ConfirmSheet title={`为 ${chosen.length} 名学生重置密码？`} confirm="重置并生成通知单" onClose={() => setStep(null)} onConfirm={reset}
          text="原密码立即失效。随后打印或下载重置密码通知单（每人一页），发给学生本人。">
          <SheetList people={sheetRows(chosen)} />
        </ConfirmSheet>
      )}
      {step?.kind === 'reissue' && (
        <ConfirmSheet title={`为 ${waiting.length} 名学生重新生成初始密码？`} confirm="生成通知单" onClose={() => setStep(null)} onConfirm={reissue}
          text="这些学生还未设置新密码。新的开户通知单（每人一页）上是新的初始密码，之前发出的通知单随即失效。" />
      )}
      {step?.kind === 'close' && (
        <CloseSheet people={chosen.map((s) => ({ id: s.user_id, name: s.name, no: s.student_no, balance: s.accounts?.balance }))}
          onClose={() => setStep(null)} onDone={(r) => { setStep(null); done(r); }} />
      )}
      {step?.kind === 'notices' && (step.resetAt
        ? <ResetNoticeSheet count={step.accounts.length} make={() => noticePages(step.accounts, step.resetAt)} onClose={() => setStep(null)} />
        : <OutputSheet title={`${step.accounts.length} 份开户通知单已生成`} name={`开户通知单-${today()}-${step.accounts.length}人.pdf`}
            text="通知单上是新的初始密码，关闭后不能再看到。请打印或下载后发给学生本人。"
            make={() => noticePages(step.accounts)} onClose={() => setStep(null)} />)}
      {step?.kind === 'opening' && (
        <OutputSheet title="期初余额核对表" name={`期初余额核对表-${today()}.pdf`} text="每个班一页，列出系统里的期初余额，留空一栏与原账本逐人核对。"
          make={openings} onClose={() => setStep(null)} />
      )}
    </Desk>
  );
}

function Row({ s, pick }: { s: AdminStudent; pick: React.ReactNode }) {
  return (
    <li className={pick ? 'dc-batch-row' : undefined}>
      {pick}
      <a className="dc-list-link" {...link(`/admin/students/${s.student_no}`)}>
        <Avatar role="student" />
        <span>
          {s.name}
          {s.profiles?.must_change_password && <> <span className="dc-tag"><Icon name="lock" />未设置密码</span></>}
          {s.status !== 'normal' && <> <span className="dc-tag dc-tag-danger"><Icon name="warning" />{STATUS[s.status]}</span></>}
          <small className="dc-top-sub">{classOf(s)} · 学号 {s.student_no}{s.accounts && ` · 余额 ${formatAmount(s.accounts.balance)} HTB`}</small>
        </span>
        <Icon name="next" />
      </a>
    </li>
  );
}
