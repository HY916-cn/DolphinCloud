import { Desk, Icon, link, Notice } from '@/components';
import { ROLES } from '@/lib/session';
import { useStaff } from '@/lib/staff';

// 工作人员: every staff login with its role; 新增 opens the form, a row opens the login.
export default function Staff() {
  const staff = useStaff();
  return (
    <Desk title="工作人员" actions={<a className="dc-btn dc-btn-secondary dc-btn-sm" {...link('/admin/staff/new')}>新增账号</a>}>
      {staff.isError && <Notice tone="danger" title="暂时无法读取工作人员">请检查网络后刷新页面。</Notice>}
      {staff.isPending ? <span className="dc-skeleton" style={{ height: 240, borderRadius: 'var(--radius-lg)' }} /> : staff.data && (
        <ul className="dc-list dc-enter" aria-label="工作人员">
          {staff.data.map((p) => (
            <li key={p.id}>
              <a className="dc-list-link" {...link(`/admin/staff/${p.id}`)}>
                <span className="dc-list-icon"><Icon name="teacher" /></span>
                <span>
                  {p.display_name}
                  {p.disabled && <> <span className="dc-tag dc-tag-danger"><Icon name="warning" />已停用</span></>}
                  {!p.disabled && p.must_change_password && <> <span className="dc-tag"><Icon name="lock" />未设置密码</span></>}
                  <small className="dc-top-sub">{p.role ? ROLES[p.role] : '未分配身份'} · 账号 {p.login_id}</small>
                </span>
                <Icon name="next" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Desk>
  );
}
