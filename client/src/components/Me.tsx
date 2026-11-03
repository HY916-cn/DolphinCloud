import { savedAccounts } from '@/lib/accounts';
import { formatAmount } from '@/lib/format';
import { ROLES, type Me, type Student } from '@/lib/session';
import { signed, useTerm } from './Account';
import { SaveLogin } from './Accounts';
import { DIVISIONS } from './Ranking';
import { SignOut } from './Sheet';
import { Icon, link } from './ui';

const STATUS = { normal: '在读', frozen: '已冻结', graduated: '已毕业' } as const;

// A student's balance beside the name.
function Balance({ s }: { s: Student }) {
  const term = useTerm(s.student_no).data;
  return term ? <div className="dc-person-side">{formatAmount(term.balance)}<small>当前余额 HTB</small></div> : null;
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
          <div><dt>学部</dt><dd>{DIVISIONS[s.division]}</dd></div>
          <div><dt>学届</dt><dd>{s.cohort} 届</dd></div>
          <div><dt>账户状态</dt><dd>{value(term && STATUS[term.status])}</dd></div>
          <div><dt>本学期存入</dt><dd>{value(term && signed(term.tide.saved))}</dd></div>
          <div><dt>本学期支出</dt><dd>{value(term && signed(term.tide.spent))}</dd></div>
        </dl>
      </section>
    </div>
  );
}

// 我的 (every login): who is signed in, 切换账号 (this device's accounts), 在此设备保存登录 and 退出账号; a student also
// sees the balance and 我的账户 beside them.
export function MeView({ me }: { me: Me }) {
  const s = me.student;
  const others = savedAccounts().filter((a) => a.id !== me.profile.id).length;
  const main = (
    <div className="dc-stack dc-enter">
      <div className="dc-person">
        <span className="dc-person-avatar"><Icon name={s ? 'me' : 'teacher'} /></span>
        <div className="dc-person-main">
          <div className="dc-person-name">{s?.name ?? me.profile.display_name}</div>
          <div className="dc-person-meta">
            {s ? <><span>{s.class_label ?? `${s.class_no} 班`}</span> · <span>学号 {s.student_no}</span></>
              : <><span>{me.roles.map((r) => ROLES[r]).join('、') || '未分配身份'}</span> · <span>账号 {me.profile.login_id}</span></>}
          </div>
        </div>
        {s && <Balance s={s} />}
      </div>
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
