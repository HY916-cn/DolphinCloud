import { Gate, Icon, link, SignOutBlock, Welcome, type IconName } from '@/components';
import { destinations } from '@/lib/session';

const PLACES: Record<string, { icon: IconName; label: string; note: string }> = {
  '/counter': { icon: 'coin', label: '柜台', note: '存款、取款、兑换' },
  '/admin': { icon: 'teacher', label: '后台', note: '账户与管理' },
  '/student': { icon: 'me', label: '我的账户', note: '余额与明细' },
};

// For logins with more than one place to work, e.g. a student who is also a teller.
export default function Workspace() {
  return (
    <Gate allow={(me) => destinations(me).length > 1}>
      {(me) => (
        <Welcome label="选择页面">
          <h2 className="dc-login-title">你好，{me.profile.display_name}</h2>
          <div>
            <p className="dc-list-title">请选择要进入的页面</p>
            <ul className="dc-list">
              {destinations(me).map((href) => (
                <li key={href}>
                  <a className="dc-list-link" {...link(href)}>
                    <span className="dc-list-icon"><Icon name={PLACES[href].icon} /></span>
                    <span>{PLACES[href].label}<small className="dc-top-sub">{PLACES[href].note}</small></span>
                    <Icon name="next" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <SignOutBlock />
        </Welcome>
      )}
    </Gate>
  );
}
