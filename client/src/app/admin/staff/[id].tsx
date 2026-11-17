import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  Avatar, CloseSheet, ConfirmSheet, Desk, Icon, KvLoading, link, Notice, PersonLoading, ResetNoticeSheet, SalaryAccount, SkeletonGroup, staffNotice, staffNoticePages, Summary,
  type StaffNotice,
} from '@/components';
import { readPayroll, usePayroll } from '@/lib/attendance';
import { PAID_ROLES } from '@/lib/salary';
import { AppError, explain } from '@/lib/errors';
import { formatTime } from '@/lib/format';
import { call } from '@/lib/rpc';
import { bankAdmin, managesLogins, ROLES, useMe, type Role } from '@/lib/session';
import { useStaff } from '@/lib/staff';

type Action = { title: string; text: string; confirm: string; fn: string; args: Record<string, unknown>; done: string };

// One staff login: correct its role, reset its password, stop or restore it, or close it for good (注销). Only a
// teacher manages a teacher's login, which is never closed, and nobody stops or closes their own (PHASE-1.md §6.4). Links to the transactions a teller handled (流水 is the teacher's) and
// to the login's 日志. A counted login's 考勤 (teller, accountant, storekeeper, president): whether they are counted,
// which the bank admin switches, and their 工资账户.
export default function StaffLogin() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe().data!;
  const queryClient = useQueryClient();
  const staff = useStaff();
  const payroll = usePayroll();
  const p = staff.data?.find((s) => s.id === id);
  const [role, setRole] = useState<Role | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [closing, setClosing] = useState(false);
  const [notice, setNotice] = useState<{ staff: StaffNotice; at: Date } | null>(null);
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; title: string; text: string } | null>(null);
  const canManage = !!p && p.role !== 'teacher' && managesLogins(me);
  const roles = (Object.keys(ROLES) as Role[]).filter((r) => r !== 'teacher');
  const picked = role ?? p?.role ?? 'teller';

  async function run(a: Action) {
    setAction(null);
    try {
      // A teller's notice names the pay account; read it first, so a failed read costs no password.
      const pay = a.fn === 'reset_password' ? (await readPayroll()).find((x) => x.user_id === p!.id) : undefined;
      const r = await call<{ password?: string } | null>(a.fn, a.args);
      // reset_password answers with the new initial password, which goes out once, on the notice.
      if (r?.password) setNotice({ staff: staffNotice(p!, r.password, pay), at: new Date() });
      setResult({ tone: 'success', title: a.done, text: r?.password ? '新的初始密码在通知单上，请转交本人，下次登录时需要设置新密码。' : '' });
      setRole(null);
      queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
    } catch (err) {
      setResult({ tone: 'danger', ...explain(err instanceof AppError ? err.code : '', { ...(err instanceof AppError ? err.detail : {}), payroll: a.fn === 'set_attendance' }) });
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
              <Avatar role={p.role} lg className="dc-person-avatar" />
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
            {p.role && (PAID_ROLES as Role[]).includes(p.role) && (
              <>
                <div>
                  <p className="dc-list-title">考勤</p>
                  <ul className="dc-list">
                    <li>
                      <label className="dc-switch">
                        <span className="dc-switch-text"><b>参与考勤</b><small>开启后，柜员上班时自动记班次，其他身份在「我的」里签到。</small></span>
                        <input type="checkbox" role="switch" checked={!!payroll.data?.find((x) => x.user_id === p.id)?.attendance}
                          disabled={!me.roles.includes('teacher') || !payroll.data}
                          onChange={(e) => run({ title: '', text: '', confirm: '', fn: 'set_attendance', args: { p_user_id: p.id, p_on: e.target.checked },
                            done: e.target.checked ? '已参与考勤' : '已停止考勤' })} />
                        <span className="dc-switch-track" />
                      </label>
                    </li>
                  </ul>
                </div>
                <SalaryAccount userId={p.id} payroll={payroll.data?.find((x) => x.user_id === p.id)} readOnly={!managesLogins(me)} admin={managesLogins(me) && p.id !== me.profile.id} />
              </>
            )}
            <ul className="dc-list" aria-label="相关记录">
              {p.role === 'teller' && bankAdmin(me) && (
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
                onClick={() => setAction({ title: `把 ${p.display_name} 改为${ROLES[picked]}？`, text: '对方下次打开页面时生效。',
                  confirm: '确认修改', fn: 'set_role', args: { p_user_id: p.id, p_role: picked }, done: '身份已修改' })}>
                保存身份
              </button>
              <button className="dc-btn dc-btn-secondary" type="button"
                onClick={() => setAction({ title: `重置 ${p.display_name} 的密码？`,
                  text: '将生成新的初始密码，随后打印或下载通知单转交本人；下次登录时需要设置新密码，已登录的设备会退出登录。',
                  confirm: '重置密码', fn: 'reset_password', args: { p_user_id: p.id }, done: '密码已重置' })}>
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
              {p.id !== me.profile.id && (
                <button className="dc-btn dc-btn-ghost is-danger" type="button" onClick={() => { setResult(null); setClosing(true); }}>注销账号</button>
              )}
            </div>
          ) : p.role === 'teacher' && managesLogins(me) && (
            <Notice title="银行管理员忘记密码时">由服务器维护人员运行 dolphin reset-admin 重置。</Notice>
          )}
        </div>
      )}
      {closing && p && (
        <CloseSheet people={[{ id: p.id, name: p.display_name, no: p.login_id }]} onClose={() => setClosing(false)}
          onDone={(r) => {
            setClosing(false);
            if (r.tone === 'danger') return setResult(r);
            queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
            router.navigate('/admin/staff');
          }} />
      )}
      {notice && <ResetNoticeSheet count={1} make={() => staffNoticePages([notice.staff], notice.at)} onClose={() => setNotice(null)} />}
      {action && <ConfirmSheet title={action.title} text={action.text} confirm={action.confirm} onClose={() => setAction(null)} onConfirm={() => run(action)} />}
    </Desk>
  );
}
