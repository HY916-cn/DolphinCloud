import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Desk, Icon, link, ListLoading, LOAN_TAGS, Notice } from '@/components';
import { classOf } from '@/lib/counter';
import { formatAmount } from '@/lib/format';
import { byUrgency, nextPayment, planText, type Loan, type LoanPeriod, type LoanStatus } from '@/lib/loans';
import { readAll, supabase } from '@/lib/supabase';
import { monthDay } from '@/lib/term';

export type AdminLoan = Loan & {
  students: { name: string; class_label: string | null; class_no: number; cohort: number } | null; loan_periods: LoanPeriod[];
};
const TABS: [LoanStatus | 'all', string][] = [['all', '全部'], ['active', '还款中'], ['overdue', '已逾期'], ['closed', '已结清'], ['reversed', '已作废']];

// 贷款 (design system Loan, data.md 贷款（后台）; accountant, president, bank admin): every loan, overdue first, then the
// latest paid out; by status on the tabs with their counts, found by a student's name or number or the 贷款号. The
// 贷款号 opens the loan.
export default function Loans() {
  const [tab, setTab] = useState<LoanStatus | 'all'>('all');
  const [text, setText] = useState('');
  const loans = useQuery({
    queryKey: ['admin-loans'],
    queryFn: async () => byUrgency(await readAll<AdminLoan>((from, to) => supabase.from('loans')
      .select('*, students(name,class_label,class_no,cohort), loan_periods(*)').order('opened_on', { ascending: false }).range(from, to))),
  });
  const words = text.trim().toUpperCase();
  const found = (loans.data ?? []).filter((l) => !words || l.loan_no.includes(words) || l.student_no.includes(words) || !!l.students?.name.includes(text.trim()));
  const shown = found.filter((l) => tab === 'all' || l.status === tab);

  return (
    <Desk title="贷款">
      <div className="dc-stack dc-enter">
        <label className="dc-search">
          <Icon name="query" />
          <input type="search" aria-label="搜索贷款" placeholder="搜索学生姓名、学号或贷款号" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
          {text && <button className="dc-search-clear" type="button" aria-label="清除" onClick={() => setText('')}><Icon name="close" /></button>}
        </label>
        <div className="dc-tabs" role="tablist" aria-label="贷款状态">
          {TABS.map(([k, label]) => (
            <button key={k} id={`loans-tab-${k}`} className="dc-tabs-item" role="tab" type="button" aria-selected={tab === k} aria-controls="loans-panel"
              onClick={() => setTab(k)}>{label} {found.filter((l) => k === 'all' || l.status === k).length}</button>
          ))}
        </div>
      </div>
      <section id="loans-panel" className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties} role="tabpanel" aria-labelledby={`loans-tab-${tab}`}>
        {loans.isError ? <Notice tone="danger" title="暂时无法读取贷款">请检查网络后刷新页面。</Notice>
          : !loans.data ? <ListLoading rows={4} label="正在加载贷款" />
          : !shown.length ? <div className="dc-card"><p className="dc-top-sub">{loans.data.length ? '没有符合条件的贷款。' : '还没有贷款。'}</p></div>
          : (
            <div className="dc-card">
              <div className="dc-table-scroll">
                <table className="dc-table" aria-label="贷款">
                  <thead>
                    <tr>
                      <th scope="col">贷款号</th><th scope="col">学生</th><th scope="col" className="n">本金</th><th scope="col" className="n">剩余本金</th>
                      <th scope="col">还款方式</th><th scope="col">下次应还</th><th scope="col">状态</th><th scope="col">放款日</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((l) => {
                      const next = (l.status === 'active' || l.status === 'overdue') && nextPayment(l);
                      return (
                        <tr key={l.id}>
                          <td><a {...link(`/admin/loans/${l.id}`)}>{l.loan_no}</a></td>
                          <td>{l.students?.name}<small className="dc-top-sub">{l.students && classOf(l.students)}</small></td>
                          <td className="n">{formatAmount(l.principal)}</td>
                          <td className="n">{formatAmount(l.remaining)}</td>
                          <td>{planText(l.plan, l.periods, true)}</td>
                          <td>{next ? `${monthDay(next.due_on)} ${formatAmount(next.amount)}` : '—'}</td>
                          <td>{LOAN_TAGS[l.status]}</td>
                          <td>{monthDay(l.opened_on)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
      </section>
    </Desk>
  );
}
