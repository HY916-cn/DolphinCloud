import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Desk, eachOf, Icon, Notice, staffNotice, StaffNoticeSheet, type StaffNotice } from '@/components';
import { AppError, explain } from '@/lib/errors';
import { call } from '@/lib/rpc';
import { ROLES, type Role } from '@/lib/session';

const LOGIN = /^[a-z0-9][a-z0-9_.-]{1,31}$/;

// 新增账号: one staff login with one role, on an initial password the server makes up (create_staff); or many at once,
// pasted one per line. Either way the passwords go out once, on one notice each. The one 银行管理员 already exists.
export default function NewStaff() {
  const queryClient = useQueryClient();
  const roles = (Object.keys(ROLES) as Role[]).filter((r) => r !== 'teacher');
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('teller');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [notice, setNotice] = useState<StaffNotice | null>(null);
  const id = login.trim().toLowerCase();
  const loginOk = LOGIN.test(id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!loginOk || !name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ password: string }>('create_staff', { p_login_id: id, p_name: name.trim(), p_role: role });
      queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
      setCreated(`${name.trim()}（${ROLES[role]}）的账号 ${id} 已创建。初始密码在通知单上，请转交本人，首次登录后需要设置新密码。`);
      setNotice(staffNotice({ login_id: id, display_name: name.trim(), role }, r.password));
      setLogin('');
      setName('');
      setTried(false);
    } catch (err) {
      setError(explain(err instanceof AppError ? err.code : '', err instanceof AppError ? err.detail : {}));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Desk title="新增账号" back={() => router.navigate('/admin/staff')}>
      <form className="dc-form dc-enter" onSubmit={submit} noValidate>
        {created && <Notice tone="success" title="账号已创建">{created}</Notice>}
        {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
        <label className={`dc-field ${tried && !loginOk ? 'is-error' : ''}`}>
          <span className="dc-field-label"><Icon name="me" />账号</span>
          <span className="dc-input-wrap">
            <input className="dc-input" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="如 teller02"
              autoComplete="off" autoCapitalize="none" spellCheck={false} />
          </span>
          <span className="dc-field-hint">
            {tried && !loginOk && <Icon name="warning" />}2–32 位小写字母、数字、. _ -，以字母或数字开头
          </span>
        </label>
        <label className={`dc-field ${tried && !name.trim() ? 'is-error' : ''}`}>
          <span className="dc-field-label"><Icon name="teacher" />姓名</span>
          <span className="dc-input-wrap"><input className="dc-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 柜员小王" /></span>
          {tried && !name.trim() && <span className="dc-field-hint"><Icon name="warning" />请填写姓名</span>}
        </label>
        <label className="dc-field">
          <span className="dc-field-label"><Icon name="settings" />身份</span>
          <span className="dc-select">
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {roles.map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
            </select>
          </span>
        </label>
        <button className="dc-btn dc-btn-primary dc-btn-block" type="submit" disabled={busy}>{busy ? '正在创建' : '创建账号'}</button>
      </form>
      <Many roles={roles} />
      {notice && <StaffNoticeSheet staff={[notice]} onClose={() => setNotice(null)} />}
    </Desk>
  );
}

// One login per line: 账号, 姓名 and optionally 身份 (柜员 when left out), apart by spaces, tabs or commas, as pasted
// from a spreadsheet.
function parse(text: string, roles: Role[]) {
  const rows: { login: string; name: string; role: Role }[] = [];
  const problems: string[] = [];
  text.split('\n').forEach((line, i) => {
    const [login = '', name = '', title = ''] = line.trim().split(/[\s,，、]+/);
    if (!line.trim()) return;
    const role = title ? roles.find((r) => ROLES[r] === title) : 'teller';
    if (!LOGIN.test(login.toLowerCase())) problems.push(`第 ${i + 1} 行：账号「${login}」不符合格式`);
    else if (!name) problems.push(`第 ${i + 1} 行：缺少姓名`);
    else if (!role) problems.push(`第 ${i + 1} 行：没有「${title}」这种身份`);
    else rows.push({ login: login.toLowerCase(), name, role });
  });
  return { rows, problems };
}

function Many({ roles }: { roles: Role[] }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; title: string; text: string } | null>(null);
  const [created, setCreated] = useState<StaffNotice[] | null>(null);
  const { rows, problems } = parse(text, roles);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rows.length || problems.length || busy) return;
    setBusy(true);
    setResult(null);
    const { done, failed } = await eachOf(rows, async (r) => staffNotice({ login_id: r.login, display_name: r.name, role: r.role },
      (await call<{ password: string }>('create_staff', { p_login_id: r.login, p_name: r.name, p_role: r.role })).password));
    queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
    setBusy(false);
    setResult(failed.length
      ? { tone: 'danger', title: `${failed.length} 个账号未能创建`, text: failed.map((f) => `${f.item.login}：${f.title}`).join('；') }
      : { tone: 'success', title: `已创建 ${done.length} 个账号`, text: '' });
    setText(failed.map((f) => `${f.item.login} ${f.item.name} ${ROLES[f.item.role]}`).join('\n'));
    if (done.length) setCreated(done);
  }

  return (
    <form className="dc-form dc-enter" style={{ '--i': 1 } as React.CSSProperties} onSubmit={submit} noValidate aria-label="批量新增">
      <p className="dc-list-title">批量新增</p>
      {result && <Notice tone={result.tone} title={result.title}>{result.text}</Notice>}
      <label className={`dc-field ${problems.length ? 'is-error' : ''}`}>
        <span className="dc-field-label"><Icon name="teacher" />每行一个账号</span>
        <span className="dc-input-wrap dc-input-area">
          <textarea className="dc-input" rows={6} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
            placeholder={'teller03 柜员小李\nteller04 柜员小张 柜员\nstore01 库管小陈 库管'} />
        </span>
        <span className="dc-field-hint">
          {problems.length ? <><Icon name="warning" />{problems.slice(0, 3).join('；')}{problems.length > 3 && ` 等 ${problems.length} 处`}</>
            : `依次写账号、姓名、身份（${roles.map((r) => ROLES[r]).join('、')}；不写为柜员），可以从表格直接粘贴。`}
        </span>
      </label>
      <button className={`dc-btn dc-btn-secondary dc-btn-block ${busy ? 'is-loading' : ''}`} type="submit" disabled={busy || !rows.length || !!problems.length}>
        {busy ? '正在创建' : `创建 ${rows.length} 个账号`}
      </button>
      {created && <StaffNoticeSheet staff={created} onClose={() => setCreated(null)} />}
    </form>
  );
}
