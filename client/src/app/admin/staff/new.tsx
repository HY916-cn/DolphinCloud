import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Desk, Icon, Notice } from '@/components';
import { AppError, explain } from '@/lib/errors';
import { call } from '@/lib/rpc';
import { ROLES, type Role } from '@/lib/session';

const LOGIN = /^[a-z0-9][a-z0-9_.-]{1,31}$/;

// 新增账号: one staff login with one role, on the default password (create_staff). The one 银行管理员 already exists.
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
  const id = login.trim().toLowerCase();
  const loginOk = LOGIN.test(id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!loginOk || !name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await call('create_staff', { p_login_id: id, p_name: name.trim(), p_role: role });
      queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
      setCreated(`${name.trim()}（${ROLES[role]}）的账号 ${id} 已创建，初始密码 a12345678，首次登录后需要设置新密码。`);
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
            {tried && !loginOk && <Icon name="warning" />}2–32 位小写字母、数字、. _ -，以字母或数字开头，用于登录
          </span>
        </label>
        <label className={`dc-field ${tried && !name.trim() ? 'is-error' : ''}`}>
          <span className="dc-field-label"><Icon name="teacher" />姓名</span>
          <span className="dc-input-wrap"><input className="dc-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 柜员小王" /></span>
          {tried && !name.trim() && <span className="dc-field-hint"><Icon name="warning" />请填写姓名，登录后显示在页面标题下</span>}
        </label>
        <label className="dc-field">
          <span className="dc-field-label"><Icon name="settings" />身份</span>
          <span className="dc-select">
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {roles.map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
            </select>
          </span>
          <span className="dc-field-hint">每个账号只有一种身份；同一个人担任两种身份时请分别建账号。</span>
        </label>
        <button className="dc-btn dc-btn-primary dc-btn-block" type="submit" disabled={busy}>{busy ? '正在创建' : '创建账号'}</button>
      </form>
    </Desk>
  );
}
