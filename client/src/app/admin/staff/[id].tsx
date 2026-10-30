import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ConfirmSheet, Desk, Icon, KvLoading, link, Notice, PersonLoading, SkeletonGroup, Summary } from '@/components';
import { AppError, explain } from '@/lib/errors';
import { formatTime } from '@/lib/format';
import { call } from '@/lib/rpc';
import { ROLES, useMe, type Role } from '@/lib/session';
import { useStaff } from '@/lib/staff';

type Action = { title: string; text: string; confirm: string; fn: string; args: Record<string, unknown>; done: string };

// One staff login: correct its role, reset its password, stop or restore it. Only a teacher manages a teacher's login,
// and nobody stops their own (PHASE-1.md §6.4). Links to the transactions a teller handled (流水 is the teacher's) and
// to the login's 日志.
export default function StaffLogin() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe().data!;
  const queryClient = useQueryClient();
  const staff = useStaff();
  const p = staff.data?.find((s) => s.id === id);
  const [role, setRole] = useState<Role | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; title: string; text: string } | null>(null);
  const canManage = !!p && p.role !== 'teacher';
  const roles = (Object.keys(ROLES) as Role[]).filter((r) => r !== 'teacher');
  const picked = role ?? p?.role ?? 'teller';

  async function run(a: Action) {
    setAction(null);
    try {
      await call(a.fn, a.args);
      setResult({ tone: 'success', title: a.done, text: '' });
      setRole(null);
      queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
    } catch (err) {
      setResult({ tone: 'danger', ...explain(err instanceof AppError ? err.code : '', err instanceof AppError ? err.detail : {}) });
    }
  }

  return (
    <Desk title="工作人员" back={() => router.navigate('/admin/staff')}>
      {staff.isError && <Notice tone="danger" title="暂时无法读取工作人员">请检查网络后刷新页面。</Notice>}
      {staff.isPending && <SkeletonGroup className="dc-stack"><PersonLoading /><KvLoading /></SkeletonGroup>}
      {staff.data && !p && <Notice tone="danger" title="未找到该账号">请返回列表重新选择。</Notice>}
      {p && (
        <div className="dc-split">
          <div className="dc-stack dc-enter">
            <div className="dc-person">
              <span className="dc-person-avatar"><Icon name="teacher" /></span>
              <div className="dc-person-main">
                <div className="dc-person-name">{p.display_name}</div>
                <div className="dc-person-meta"><span>{p.role ? ROLES[p.role] : '未分配身份'}</span> · <span>账号 {p.login_id}</span></div>
              </div>
            </div>
            {result && <Notice tone={result.tone} title={result.title}>{result.text || undefined}</Notice>}
            <div className="dc-card">
              <Summary rows={[
                ['状态', p.disabled ? '已停用' : '正常'],
                ['密码', p.must_change_password ? '还未设置新密码' : '已设置新密码'],
                ['创建时间', formatTime(p.created_at)],
              ]} />
            </div>
            <ul className="dc-list" aria-label="相关记录">
              {p.role === 'teller' && me.roles.includes('teacher') && (
                <li>
                  <a className="dc-list-link" {...link(`/admin/txns?operator=${p.id}`)}>
                    <span className="dc-list-icon"><Icon name="passbook" /></span><span>查看他办理的流水</span><Icon name="next" />
                  </a>
                </li>
              )}
              <li>
                <a className="dc-list-link" {...link(`/admin/audit?actor=${p.id}`)}>
                  <span className="dc-list-icon"><Icon name="bell" /></span><span>操作日志</span><Icon name="next" />
                </a>
              </li>
            </ul>
          </div>
          {canManage ? (
            <div className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties}>
              <label className="dc-field">
                <span className="dc-field-label"><Icon name="settings" />身份</span>
                <span className="dc-select">
                  <select value={picked} onChange={(e) => setRole(e.target.value as Role)}>
                    {roles.map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
                  </select>
                </span>
              </label>
              <button className="dc-btn dc-btn-primary" type="button" disabled={picked === p.role}
                onClick={() => setAction({ title: `把 ${p.display_name} 改为${ROLES[picked]}？`, text: '账号只保留这一种身份，下次打开页面时生效。',
                  confirm: '确认修改', fn: 'set_role', args: { p_user_id: p.id, p_role: picked }, done: '身份已修改' })}>
                保存身份
              </button>
              <button className="dc-btn dc-btn-secondary" type="button"
                onClick={() => setAction({ title: `重置 ${p.display_name} 的密码？`,
                  text: '密码恢复为 a12345678，下次登录时需要设置新密码；已登录的设备会退出登录。',
                  confirm: '重置密码', fn: 'reset_password', args: { p_user_id: p.id }, done: '密码已重置为 a12345678' })}>
                重置密码
              </button>
              {p.id !== me.profile.id && (
                <button className={`dc-btn dc-btn-ghost ${p.disabled ? '' : 'is-danger'}`} type="button"
                  onClick={() => setAction(p.disabled
                    ? { title: `启用 ${p.display_name} 的账号？`, text: '启用后可以用原密码登录。', confirm: '启用账号',
                        fn: 'set_user_disabled', args: { p_user_id: p.id, p_disabled: false }, done: '账号已启用' }
                    : { title: `停用 ${p.display_name} 的账号？`, text: '停用后无法登录，已登录的设备会退出登录；之后可以随时启用。',
                        confirm: '停用账号', fn: 'set_user_disabled', args: { p_user_id: p.id, p_disabled: true }, done: '账号已停用' })}>
                  {p.disabled ? '启用账号' : '停用账号'}
                </button>
              )}
            </div>
          ) : (
            <Notice title="银行管理员只有一个">这个账号的身份不能更改，也不能停用。忘记密码时，由服务器维护人员运行 dolphin reset-admin 恢复为默认密码。</Notice>
          )}
        </div>
      )}
      {action && <ConfirmSheet title={action.title} text={action.text} confirm={action.confirm} onClose={() => setAction(null)} onConfirm={() => run(action)} />}
    </Desk>
  );
}
