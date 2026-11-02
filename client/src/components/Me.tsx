import { savedAccounts } from '@/lib/accounts';
import { ROLES, type Me } from '@/lib/session';
import { SignOut } from './Sheet';
import { Icon, link } from './ui';

// 我的 (every login): who is signed in, 切换账号 (the login page, with this device's accounts) and 退出账号.
export function MeView({ me }: { me: Me }) {
  const s = me.student;
  const others = savedAccounts().filter((a) => a.id !== me.profile.id).length;
  return (
    <div className="dc-stack dc-enter">
      <div className="dc-person">
        <span className="dc-person-avatar"><Icon name={s ? 'me' : 'teacher'} /></span>
        <div className="dc-person-main">
          <div className="dc-person-name">{s?.name ?? me.profile.display_name}</div>
          <div className="dc-person-meta">
            {s ? <><span>{s.class_label ?? `${s.class_no} 班`}</span> · <span>{s.cohort} 届</span> · <span>学号 {s.student_no}</span></>
              : <><span>{me.roles.map((r) => ROLES[r]).join('、') || '未分配身份'}</span> · <span>账号 {me.profile.login_id}</span></>}
          </div>
        </div>
      </div>
      <ul className="dc-list">
        <li>
          <a className="dc-list-link" {...link('/login?add=1')}>
            <span className="dc-list-icon"><Icon name="me" /></span>
            <span>切换账号<small className="dc-top-sub">{others ? `这台设备上还有 ${others} 个账号` : '登录其他账号、在此设备保存登录'}</small></span>
            <Icon name="next" />
          </a>
        </li>
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
}
