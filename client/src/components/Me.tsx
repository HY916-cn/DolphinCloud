import { savedAccounts } from '@/lib/accounts';
import { formatAmount } from '@/lib/format';
import { ROLES, type Me, type Student } from '@/lib/session';
import { signed, useTerm } from './Account';
import { SaveLogin } from './Accounts';
import { DIVISIONS } from './Ranking';
import { SignOut } from './Sheet';
import { Icon, link } from './ui';

const STATUS = { normal: '在读', frozen: '已冻结', graduated: '已毕业' } as const;

// The closed 存折 on a student's 我的: the bank's name and 储蓄存折 in gold foil, and the label with 户名, 账号 and 班级.
export function StudentCover({ s }: { s: Student }) {
  return (
    <div className="dc-pb-cover dc-enter">
      <p className="dc-pb-foil">海豚银行</p>
      <img src="/logo.png" alt="" />
      <h2 className="dc-pb-foil is-title">储蓄存折</h2>
      <div className="dc-pb-label">
        <p><span>户名</span><b className="dc-pb-name">{s.name}</b></p>
        <p><span>账号</span>{s.student_no}</p>
        <p><span>班级</span>{s.class_label ?? `${s.class_no} 班`}</p>
      </div>
    </div>
  );
}

// 我的账户: the student's division, cohort, account status and this term's money in and out.
function StudentAccount({ s }: { s: Student }) {
  const term = useTerm(s.student_no).data;
  const value = (v: string | undefined) => v ?? <span className="dc-skeleton" style={{ display: 'inline-block', width: 48, height: 22 }} />;
  return (
    <div className="dc-stack is-sticky dc-enter" style={{ '--i': 1 } as React.CSSProperties}>
      <section className="dc-card">
        <h2 className="heading" style={{ margin: '0 0 var(--space-3)' }}>我的账户</h2>
        <dl className="dc-kv">
          <div className="is-total"><dt>当前余额</dt><dd>{value(term && formatAmount(term.balance))}<small>HTB</small></dd></div>
          <div><dt>学部</dt><dd>{DIVISIONS[s.division]}</dd></div>
          <div><dt>学届</dt><dd>{s.cohort} 届</dd></div>
          <div><dt>账户状态</dt><dd>{value(term && STATUS[term.status])}</dd></div>
          <div><dt>本学期存入</dt><dd>{value(term && signed(term.saved))}</dd></div>
          <div><dt>本学期支出</dt><dd>{value(term && signed(term.spent))}</dd></div>
        </dl>
      </section>
    </div>
  );
}

// 我的 (every login): who is signed in, 切换账号 (this device's accounts), 在此设备保存登录 and 退出账号; a student sees
// their closed 存折 (StudentCover) above the list and 我的账户 beside it.
export function MeView({ me }: { me: Me }) {
  const s = me.student;
  const others = savedAccounts().filter((a) => a.id !== me.profile.id).length;
  const main = (
    <div className="dc-stack dc-enter">
      {s && <StudentCover s={s} />}
      {!s && <div className="dc-person">
        <span className="dc-person-avatar"><Icon name="teacher" /></span>
        <div className="dc-person-main">
          <div className="dc-person-name">{me.profile.display_name}</div>
          <div className="dc-person-meta">
            <span>{me.roles.map((r) => ROLES[r]).join('、') || '未分配身份'}</span> · <span>账号 {me.profile.login_id}</span>
          </div>
        </div>
      </div>}
      <ul className="dc-list">
        <li>
          <a className="dc-list-link" {...link('/login?switch=1')}>
            <span className="dc-list-icon"><Icon name="me" /></span>
            <span>切换账号<small className="dc-top-sub">{others ? `这台设备上还有 ${others} 个账号` : '登录其他账号'}</small></span>
            <Icon name="next" />
          </a>
        </li>
        <li><SaveLogin id={me.profile.id} /></li>
        <li>
          <SignOut trigger={(open) => (
            <a className="dc-list-link is-danger" href="#" role="button" onClick={(e) => { e.preventDefault(); open(); }}>
              <span className="dc-list-icon"><Icon name="logout" /></span><span>退出账号</span><Icon name="next" />
            </a>
          )} />
        </li>
      </ul>
    </div>
  );
  return s ? <div className="dc-split">{main}<StudentAccount s={s} /></div> : main;
}
