import { useMemo, useState } from 'react';
import { AccountNotices, Desk, Icon, link, ListLoading, Notice, OpeningSheet } from '@/components';
import { classOf } from '@/lib/counter';
import { formatAmount } from '@/lib/format';
import { searchRoster } from '@/lib/search';
import { useMe } from '@/lib/session';
import { STATUS, useStudents, type AdminStudent } from '@/lib/students';
import { readAll, supabase } from '@/lib/supabase';

const SHOWN = 100;

// 学生: find any student by name, pinyin, class or number; import the roster and print the opening balance check
// sheet (teacher); print the notices of the students who have not signed in yet.
export default function Students() {
  const me = useMe().data!;
  const students = useStudents();
  const [query, setQuery] = useState('');
  const [printing, setPrinting] = useState<'notices' | Map<string, number> | null>(null);
  const [opening, setOpening] = useState<'loading' | 'failed' | null>(null);
  const all = students.data?.rows ?? [];
  const list = useMemo(() => (query.trim() ? searchRoster(students.data?.index ?? [], query, SHOWN) : all.slice(0, SHOWN)), [students.data, query]);
  const waiting = all.filter((s) => s.profiles?.must_change_password);
  const teacher = me.roles.includes('teacher');

  // Each student's 'opening' transaction (at most one, txns_one_opening); a student without one opened at 0.
  async function printOpenings() {
    setOpening('loading');
    try {
      const rows = await readAll<{ student_no: string; amount: number }>((from, to) =>
        supabase.from('txns').select('student_no,amount').eq('type', 'opening').order('student_no').range(from, to));
      setPrinting(new Map(rows.map((r) => [r.student_no, r.amount])));
      setOpening(null);
      setTimeout(print);
    } catch {
      setOpening('failed');
    }
  }

  return (
    <Desk title="学生">
      <form role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="dc-search">
          <Icon name="query" />
          <input type="search" aria-label="搜索学生" placeholder="输入姓名、拼音首字母、班级或学号" autoComplete="off"
            enterKeyHint="search" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button className="dc-search-clear" type="button" aria-label="清除" onClick={() => setQuery('')}><Icon name="close" /></button>}
        </label>
      </form>
      {students.isError && <Notice tone="danger" title="暂时无法读取名册">请检查网络后刷新页面。</Notice>}
      {opening === 'failed' && <Notice tone="danger" title="暂时无法读取期初余额">请检查网络后再打印。</Notice>}
      <div className="dc-section-head">
        <p className="dc-top-sub">{students.data && <>共 {all.length} 名学生{waiting.length > 0 && `，${waiting.length} 人还未设置新密码`}</>}</p>
        <span style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {waiting.length > 0 && (
            <button className="dc-btn dc-btn-ghost dc-btn-sm" type="button" onClick={() => { setPrinting('notices'); setTimeout(print); }}>
              打印开户通知单
            </button>
          )}
          {teacher && all.length > 0 && (
            <button className={`dc-btn dc-btn-ghost dc-btn-sm ${opening === 'loading' ? 'is-loading' : ''}`} type="button" onClick={printOpenings}>
              打印期初余额核对表
            </button>
          )}
          {teacher && <a className="dc-btn dc-btn-secondary dc-btn-sm" {...link('/admin/students/import')}>导入名册</a>}
        </span>
      </div>
      {students.isPending ? <ListLoading rows={6} label="正在加载学生" />
        : list.length ? (
          <ul className="dc-list" aria-label="学生">
            {list.map((s) => <Row key={s.student_no} s={s} />)}
          </ul>
        ) : students.data && (
          <div className="dc-empty">
            <span className="dc-empty-icon"><Icon name={query ? 'query' : 'me'} /></span>
            <h3>{query ? `没有找到「${query.trim()}」` : '还没有学生'}</h3>
            <p>{query ? '换个写法试试：姓名、拼音首字母、班级或学号。' : '导入名册后，这里会列出全部学生。'}</p>
          </div>
        )}
      {!query && all.length > SHOWN && <p className="dc-top-sub">只列出前 {SHOWN} 人，输入姓名、班级或学号查找其余学生。</p>}
      {printing === 'notices' && <AccountNotices students={waiting} />}
      {printing instanceof Map && <OpeningSheet students={all} openings={printing} />}
    </Desk>
  );
}

function Row({ s }: { s: AdminStudent }) {
  return (
    <li>
      <a className="dc-list-link" {...link(`/admin/students/${s.student_no}`)}>
        <span className="dc-list-icon"><Icon name="me" /></span>
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
