import { BookPages, DIVISIONS, Icon, link, PassbookPage, SaveLogin, signed, SignOut, useCloseBook, useTerm, ViewSwitch } from '@/components';
import { formatAmount } from '@/lib/format';
import { useMe } from '@/lib/session';

const STATUS = { normal: '在读', frozen: '已冻结', graduated: '已毕业' } as const;

// The holder's name seal, four characters in two columns as a 印章 has them: 张小明印, 王雨之印.
const chop = (name: string) => (name.length === 2 ? `${name}之印` : name.length === 3 ? `${name}印` : name.slice(0, 4));

// 我的: the account holder's page with the name seal kept on file; facing it, the 存折's own settings: 页面样式, 切换账号,
// 在此设备保存登录, and closing the 存折, which signs out once its cover has shut.
export default function BookMe() {
  const me = useMe().data!;
  const s = me.student!;
  const term = useTerm(s.student_no).data;
  const close = useCloseBook();

  return (
    <BookPages pages={[
      <PassbookPage key="holder" title="户主信息">
        <dl className="dc-pb-fields">
          <dt>户名</dt><dd>{s.name}</dd>
          <dt>账号</dt><dd>{s.student_no}</dd>
          <dt>班级</dt><dd>{s.class_label ?? `${s.class_no} 班`}</dd>
          <dt>学部</dt><dd>{DIVISIONS[s.division]}</dd>
          <dt>学届</dt><dd>{s.cohort} 届</dd>
          <dt>账户状态</dt><dd>{term ? STATUS[term.status] : '…'}</dd>
        </dl>
        <dl className="dc-pb-fields dc-pb-sums">
          <dt>当前余额</dt><dd className="is-total">{term ? formatAmount(term.balance) : '…'}<small>HTB</small></dd>
          <dt>本学期存入</dt><dd className="is-in">{term ? signed(term.saved) : '…'}</dd>
          <dt>本学期支出</dt><dd>{term ? signed(term.spent) : '…'}</dd>
        </dl>
        <div className="dc-pb-chop-box"><span>预留印鉴</span><b className="dc-pb-chop" aria-hidden="true">{chop(s.name)}</b></div>
      </PassbookPage>,
      <PassbookPage key="settings" title="存折设置">
        <ViewSwitch current="book" />
        <ul className="dc-list dc-pb-actions">
          <li>
            <a className="dc-list-link" {...link('/login?switch=1')}>
              <span className="dc-list-icon"><Icon name="me" /></span>
              <span>切换账号<small className="dc-top-sub">登录其他账号</small></span><Icon name="next" />
            </a>
          </li>
          <li><SaveLogin id={me.profile.id} /></li>
          <li>
            <SignOut to="/book" before={close} trigger={(open) => (
              <a className="dc-list-link is-danger" href="#" role="button" onClick={(e) => { e.preventDefault(); open(); }}>
                <span className="dc-list-icon"><Icon name="lock" /></span><span>合上存折<small className="dc-top-sub">退出登录，下次用密码打开</small></span><Icon name="next" />
              </a>
            )} />
          </li>
        </ul>
      </PassbookPage>,
    ]} />
  );
}
