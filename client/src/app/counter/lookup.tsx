import { useState } from 'react';
import { CounterPage, FindStudent, NeedsNetwork, PersonCard, Summary } from '@/components';
import { useSettings, type Student } from '@/lib/counter';
import { formatAmount } from '@/lib/format';
import { useOnline } from '@/lib/online';

const STATUS: Record<string, string> = { normal: '正常', frozen: '已冻结', graduated: '已毕业' };

// 查询: a student's balance and today's withdrawal room, without any business.
export default function Lookup() {
  const online = useOnline();
  const settings = useSettings();
  const [student, setStudent] = useState<Student | null>(null);

  if (!online) {
    return (
      <CounterPage title="查询">
        <NeedsNetwork business="查询" />
      </CounterPage>
    );
  }
  if (!student) return <CounterPage title="查询"><FindStudent onFound={setStudent} /></CounterPage>;

  const daily = settings.daily[student.division];
  return (
    <CounterPage title="查询" onBack={() => setStudent(null)}>
      <div className="dc-form dc-stack">
        <PersonCard student={student} />
        <div className="dc-card dc-enter">
          <Summary rows={[
            ['余额', `${formatAmount(student.balance ?? 0)} HTB`],
            ['今日已取款', `${formatAmount(student.withdrawn_today ?? 0)} HTB`],
            ['今日还可取', daily === undefined ? '—' : `${formatAmount(Math.max(daily - (student.withdrawn_today ?? 0), 0))} HTB`],
            ['学部', student.division === 'junior' ? '初中部' : '小学部'],
            ['学届', `${student.cohort} 届`],
            ['账户状态', STATUS[student.status] ?? student.status],
          ]} />
        </div>
        <div className="dc-actions">
          <button className="dc-btn dc-btn-primary" type="button" autoFocus onClick={() => setStudent(null)}>查询下一位</button>
        </div>
      </div>
    </CounterPage>
  );
}
