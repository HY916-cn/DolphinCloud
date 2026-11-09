import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Avatar, BatchBar, CloseSheet, ConfirmSheet, Desk, eachOf, Icon, link, ListLoading, Notice, Pick, ResetNoticeSheet, SheetList, staffNotice, staffNoticePages,
  type StaffNotice,
} from '@/components';
import { readPayroll, type Payroll } from '@/lib/attendance';
import { explain } from '@/lib/errors';
import { call } from '@/lib/rpc';
import { managesLogins, ROLES, useMe } from '@/lib/session';
import { useStaff, type StaffLogin } from '@/lib/staff';

type Result = { tone: 'success' | 'danger'; title: string; text: string };
type Step = { kind: 'disable' | 'enable' | 'reset' | 'close' | 'busy' } | { kind: 'notices'; rows: StaffNotice[]; at: Date };

// 工作人员: every staff login with its role, found by name or account; stopped logins (已停用) only when asked for.
// 新增 opens the form (one, or many pasted at once); a row opens the login. 选择 stops, restores, resets the password of
// or closes (注销) many logins at once; the 银行管理员 and your own login are managed on their own page.
export default function Staff() {
  const me = useMe().data!;
  const staff = useStaff();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [stopped, setStopped] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<Step | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const all = staff.data ?? [];
  const q = query.trim().toLowerCase();
  const list = all.filter((p) => p.disabled === stopped && (!q || p.display_name.toLowerCase().includes(q) || p.login_id.includes(q)));
  const pickable = (p: StaffLogin) => p.role !== 'teacher' && p.id !== me.profile.id;
  const chosen = list.filter((p) => picked.has(p.id));
  const disabledCount = all.filter((p) => p.disabled).length;
  const sheetRows = chosen.map((p): [string, string] => [p.display_name, p.login_id]);

  function done(r: Result) {
    setResult(r);
    setPicked(new Set());
    queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
  }
  const failures = (failed: { item: StaffLogin; title: string }[]) => failed.map((f) => `${f.item.display_name}：${f.title}`).join('；');

  async function setDisabled(disabled: boolean) {
    setStep({ kind: 'busy' });
    const { done: ok, failed } = await eachOf(chosen, (p) => call('set_user_disabled', { p_user_id: p.id, p_disabled: disabled }));
    setStep(null);
    const what = disabled ? '停用' : '启用';
    done(failed.length ? { tone: 'danger', title: `${failed.length} 个账号未能${what}`, text: failures(failed) }
      : { tone: 'success', title: `已${what} ${ok.length} 个账号`, text: disabled ? '它们已退出登录，不再出现在名单里；点「已停用」查看。' : '' });
  }

  async function reset() {
    setStep({ kind: 'busy' });
    // Read before anything changes: a teller's notice names the pay account, and a failed read must cost no password.
    let payroll: Payroll[];
    try {
      payroll = await readPayroll();
    } catch {
      setStep(null);
      return setResult({ tone: 'danger', ...explain('') });
    }
    const { done: rows, failed } = await eachOf(chosen, async (p) => staffNotice(p,
      (await call<{ password: string }>('reset_password', { p_user_id: p.id })).password, payroll.find((x) => x.user_id === p.id)));
    done(failed.length ? { tone: 'danger', title: `${failed.length} 个账号未能重置密码`, text: failures(failed) }
      : { tone: 'success', title: `已重置 ${rows.length} 个账号的密码`, text: '' });
    setStep(rows.length ? { kind: 'notices', rows, at: new Date() } : null);
  }

  const busy = step?.kind === 'busy';
  return (
    <Desk title="工作人员">
      <form className="dc-card dc-stack dc-filter" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="dc-search">
          <Icon name="query" />
          <input type="search" aria-label="搜索工作人员" placeholder="输入姓名或账号" autoComplete="off" enterKeyHint="search"
            value={query} onChange={(e) => { setQuery(e.target.value); setPicked(new Set()); }} />
          {query && <button className="dc-search-clear" type="button" aria-label="清除" onClick={() => { setQuery(''); setPicked(new Set()); }}><Icon name="close" /></button>}
        </label>
        <div className="dc-filter-row">
          <div className="dc-chips" role="group" aria-label="筛选">
            <button className="dc-chip" type="button" aria-pressed={stopped} onClick={() => { setStopped(!stopped); setPicked(new Set()); }}>
              <Icon name="check" />已停用{staff.data && ` ${disabledCount}`}
            </button>
            {managesLogins(me) && (
              <button className="dc-chip" type="button" aria-pressed={picking} onClick={() => { setPicking(!picking); setPicked(new Set()); }}>
                <Icon name="check" />选择
              </button>
            )}
          </div>
          {managesLogins(me) && <span className="dc-filter-actions"><a className="dc-btn dc-btn-secondary dc-btn-sm" {...link('/admin/staff/import')}>导入</a><a className="dc-btn dc-btn-secondary dc-btn-sm" {...link('/admin/staff/new')}>新增账号</a></span>}
        </div>
      </form>
      {staff.isError && <Notice tone="danger" title="暂时无法读取工作人员">请检查网络后刷新页面。</Notice>}
      {result && <Notice tone={result.tone} title={result.title}>{result.text}</Notice>}
      <p className="dc-top-sub">{staff.data && (stopped ? `${disabledCount} 个已停用的账号` : `共 ${all.length - disabledCount} 个账号`)}</p>
      {staff.isPending ? <ListLoading label="正在加载工作人员" /> : list.length ? (
        <ul className="dc-list dc-enter" aria-label="工作人员">
          {list.map((p) => (
            <li key={p.id} className={picking ? 'dc-batch-row' : undefined}>
              {picking && (pickable(p) ? (
                <Pick label={p.display_name} checked={picked.has(p.id)} onChange={(on) => {
                  const next = new Set(picked);
                  if (on) next.add(p.id); else next.delete(p.id);
                  setPicked(next);
                }} />
              ) : <span className="dc-batch-pick" />)}
              <a className="dc-list-link" {...link(`/admin/staff/${p.id}`)}>
                <Avatar role={p.role} />
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
      ) : staff.data && (
        <div className="dc-empty">
          <span className="dc-empty-icon"><Icon name={q ? 'query' : 'teacher'} /></span>
          <h3>{q ? `没有找到「${query.trim()}」` : stopped ? '没有停用的账号' : '还没有工作人员'}</h3>
        </div>
      )}
      {picking && (
        <BatchBar count={chosen.length} total={list.filter(pickable).length}
          onAll={(on) => setPicked(on ? new Set(list.filter(pickable).map((p) => p.id)) : new Set())}>
          {stopped
            ? <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" disabled={!chosen.length || busy} onClick={() => setStep({ kind: 'enable' })}>启用</button>
            : <button className="dc-btn dc-btn-ghost dc-btn-sm is-danger" type="button" disabled={!chosen.length || busy} onClick={() => setStep({ kind: 'disable' })}>停用</button>}
          <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" disabled={!chosen.length || busy} onClick={() => setStep({ kind: 'reset' })}>重置密码</button>
          <button className="dc-btn dc-btn-ghost dc-btn-sm is-danger" type="button" disabled={!chosen.length || busy} onClick={() => setStep({ kind: 'close' })}>注销</button>
        </BatchBar>
      )}

      {(step?.kind === 'disable' || step?.kind === 'enable') && (
        <ConfirmSheet title={`${step.kind === 'disable' ? '停用' : '启用'} ${chosen.length} 个账号？`} confirm={step.kind === 'disable' ? '停用' : '启用'}
          onClose={() => setStep(null)} onConfirm={() => setDisabled(step.kind === 'disable')}
          text={step.kind === 'disable' ? '停用后立即退出登录、不能再登录，也不发放工资；记录保留，可以再启用。' : '启用后可以用原密码登录。'}>
          <SheetList people={sheetRows} />
        </ConfirmSheet>
      )}
      {step?.kind === 'reset' && (
        <ConfirmSheet title={`为 ${chosen.length} 个账号重置密码？`} confirm="重置" onClose={() => setStep(null)} onConfirm={reset}
          text="原密码立即失效，账号退出登录。随后打印或下载重置密码通知单（每人一页），转交本人。">
          <SheetList people={sheetRows} />
        </ConfirmSheet>
      )}
      {step?.kind === 'close' && (
        <CloseSheet people={chosen.map((p) => ({ id: p.id, name: p.display_name, no: p.login_id }))} onClose={() => setStep(null)}
          onDone={(r) => { setStep(null); done(r); }} />
      )}
      {step?.kind === 'notices' && <ResetNoticeSheet count={step.rows.length} make={() => staffNoticePages(step.rows, step.at)} onClose={() => setStep(null)} />}
    </Desk>
  );
}
