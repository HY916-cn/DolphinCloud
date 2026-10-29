import { useMemo, useState } from 'react';
import { AccountNotices, Desk, Icon, link, Notice } from '@/components';
import { classOf } from '@/lib/counter';
import { formatAmount } from '@/lib/format';
import { searchRoster } from '@/lib/search';
import { useMe } from '@/lib/session';
import { STATUS, useStudents, type AdminStudent } from '@/lib/students';

const SHOWN = 100;

// 学生: find any student by name, pinyin, class or number; import the roster (teacher); print the notices of the
// students who have not signed in yet.
export default function Students() {
  const me = useMe().data!;
  const students = useStudents();
  const [query, setQuery] = useState('');
  const [printing, setPrinting] = useState(false);
  const all = students.data?.rows ?? [];
  const list = useMemo(() => (query.trim() ? searchRoster(students.data?.index ?? [], query, SHOWN) : all.slice(0, SHOWN)), [students.data, query]);
  const waiting = all.filter((s) => s.profiles?.must_change_password);

  return (
    <Desk title="学生" actions={me.roles.includes('teacher') && (
      <a className="dc-btn dc-btn-secondary dc-btn-sm" {...link('/admin/students/import')}>导入名册</a>
    )}>
      <form role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="dc-search">
          <Icon name="query" />
          <input type="search" aria-label="搜索学生" placeholder="输入姓名、拼音首字母、班级或学号" autoComplete="off"
            enterKeyHint="search" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button className="dc-search-clear" type="button" aria-label="清除" onClick={() => setQuery('')}><Icon name="close" /></button>}
        </label>
      </form>
      {students.isError && <Notice tone="danger" title="暂时无法读取名册">请检查网络后刷新页面。</Notice>}
      {students.data && (
        <div className="dc-section-head">
          <p className="dc-top-sub">共 {all.length} 名学生{waiting.length > 0 && `，${waiting.length} 人还未设置新密码`}</p>
          {waiting.length > 0 && (
            <button className="dc-btn dc-btn-ghost dc-btn-sm" type="button" onClick={() => { setPrinting(true); setTimeout(print); }}>
              打印开户通知单
            </button>
          )}
        </div>
      )}
      {students.isPending ? <span className="dc-skeleton" style={{ height: 240, borderRadius: 'var(--radius-lg)' }} />
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
      {printing && <AccountNotices students={waiting} />}
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
