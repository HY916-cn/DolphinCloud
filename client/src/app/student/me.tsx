import { Icon, link, Page, SignOut } from '@/components';
import { useMe } from '@/lib/session';

// 我的: who is signed in (the grade and class lead, the cohort follows quietly) and the account actions.
export default function StudentMe() {
  const s = useMe().data!.student!;
  return (
    <Page title="我的">
      <div className="dc-split">
        <div className="dc-stack dc-enter">
          <div className="dc-person">
            <span className="dc-person-avatar"><Icon name="me" /></span>
            <div className="dc-person-main">
              <div className="dc-person-name">{s.name}</div>
              <div className="dc-person-meta">
                <span>{s.class_label ?? `${s.class_no} 班`}</span> · <span>{s.cohort} 届</span> · <span>学号 {s.student_no}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties}>
          <div>
            <p className="dc-list-title">账户与安全</p>
            <ul className="dc-list">
              <li>
                <a className="dc-list-link" {...link('/accounts')}>
                  <span className="dc-list-icon"><Icon name="transfer" /></span><span>切换账号</span><Icon name="next" />
                </a>
              </li>
              <li>
                <SignOut trigger={(open) => (
                  <a className="dc-list-link is-danger" href="#" role="button" onClick={(e) => { e.preventDefault(); open(); }}>
                    <span className="dc-list-icon"><Icon name="logout" /></span><span>退出登录</span><Icon name="next" />
                  </a>
                )} />
              </li>
            </ul>
          </div>
          <p className="dc-top-sub" style={{ margin: '0 var(--space-2)' }}>需要更换密码时，请联系银行管理员重置。</p>
        </div>
      </div>
    </Page>
  );
}
