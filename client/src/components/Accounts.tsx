import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { checkPassword, savedAccounts, setSaved, signOutAll, switchAccount, type SavedAccount } from '@/lib/accounts';
import { ConfirmSheet } from './Sheet';
import { Icon, link, Notice } from './ui';

const who = (a: SavedAccount) => (a.kind === 'student' ? `学号 ${a.loginId}` : `工作账号 ${a.loginId}`);
const SWITCH_ERRORS: Record<string, string> = {
  disabled: '这个账号已被停用，不能登录；需要恢复时请联系银行管理员。',
  LOGIN_LOCKED: '密码错误次数过多，请 15 分钟后再试。',
};

// A password asked in a sheet: switching to an account not saved on this device, or turning saving off.
function PasswordSheet({ title, text, confirm, onClose, onPassword }: {
  title: string; text: string; confirm: string; onClose: () => void; onPassword: (password: string) => Promise<string | null>;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(await onPassword(password));
    setBusy(false);
  }
  return (
    <ConfirmSheet title={title} text={text} confirm={confirm} busy={busy} ready={password.length > 0} onClose={onClose} onConfirm={submit}>
      <form className="dc-stack" onSubmit={(e) => { e.preventDefault(); if (password) submit(); }}>
        <label className="dc-field">
          <span className="dc-field-label"><Icon name="lock" />密码</span>
          <span className="dc-input-wrap">
            <input className="dc-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </span>
        </label>
        {error && <Notice tone="danger" title={error} />}
      </form>
    </ConfirmSheet>
  );
}

// 切换账号 (the login page while this device has accounts): the accounts on this device, then 添加账号, which opens the
// sign-in form. Tap one to switch: a saved one asks only who you are, another its password. The signed-in one
// (`current`) turns 在此设备保存登录 on or off (off asks its password); 退出全部账号 signs every one out.
export function DeviceAccounts({ current }: { current?: string }) {
  const queryClient = useQueryClient();
  const [, refresh] = useState(0);
  const [ask, setAsk] = useState<SavedAccount | null>(null);
  const [password, setPassword] = useState<SavedAccount | null>(null);
  const [unsave, setUnsave] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const accounts = savedAccounts();
  if (!accounts.length) return null;
  const mine = accounts.find((a) => a.id === current);

  const switched = () => { queryClient.clear(); router.replace('/'); };
  async function trySwitch(a: SavedAccount) {
    setAsk(null);
    const r = await switchAccount(a.id);
    if (!r) return switched();
    if (r === 'password') return setPassword(a);
    setProblem(SWITCH_ERRORS[r] ?? '暂时无法切换，请检查网络后重试。');
  }

  return (
    <div className="dc-stack">
      {problem && <Notice tone="danger" title="无法切换">{problem}</Notice>}
      <ul className="dc-list" aria-label="本机账号">
        {accounts.map((a) => {
          const body = (
            <>
              <span className="dc-list-icon"><Icon name={a.kind === 'student' ? 'me' : 'teacher'} /></span>
              <span>{a.name}<small className="dc-top-sub">{who(a)}{a.id !== current && !(a.saved && a.session) && ' · 需要输入密码'}</small></span>
            </>
          );
          return (
            <li key={a.id}>
              {a.id === current ? (
                <div className="dc-list-link" aria-current="true">
                  {body}
                  <button className="dc-chip lg-keep" type="button" aria-pressed={!!mine?.saved}
                    onClick={() => (mine?.saved ? setUnsave(true) : (setSaved(a.id, true), refresh((n) => n + 1)))}>
                    <Icon name="check" />保存登录
                  </button>
                </div>
              ) : (
                <a className="dc-list-link" href="/" onClick={(e) => {
                  e.preventDefault();
                  setProblem(null);
                  if (a.saved && a.session) setAsk(a);
                  else setPassword(a);
                }}>{body}<Icon name="next" /></a>
              )}
            </li>
          );
        })}
        <li>
          <a className="dc-list-link" {...link('/login?add=1')}>
            <span className="dc-list-icon"><Icon name="plus" /></span>
            <span>添加账号<small className="dc-top-sub">登录其他学生或工作人员账号</small></span>
            <Icon name="next" />
          </a>
        </li>
      </ul>
      {accounts.length > 1 && (
        <button className="dc-btn dc-btn-ghost dc-btn-sm is-danger lg-all" type="button" onClick={() => setConfirmAll(true)}>退出全部账号</button>
      )}

      {ask && (
        <ConfirmSheet title={`你是${ask.name}吗？`} cancel="不是" confirm="是，切换" text={`确定后切换到${who(ask)}。`}
          onClose={() => setAsk(null)} onConfirm={() => trySwitch(ask)} />
      )}
      {password && (
        <PasswordSheet title={`切换到${password.name}`} text={`输入${who(password)}的密码。`} confirm="切换" onClose={() => setPassword(null)}
          onPassword={async (pw) => {
            const r = await switchAccount(password.id, pw);
            if (!r) { switched(); return null; }
            return SWITCH_ERRORS[r] ?? (r === 'invalid_credentials' ? '密码不正确，请重新输入。' : '暂时无法切换，请检查网络后重试。');
          }} />
      )}
      {unsave && current && (
        <PasswordSheet title="不再在此设备保存登录？" confirm="确认关闭" onClose={() => setUnsave(false)}
          text="关闭后，从其他账号切换回这个账号时需要输入密码。请输入当前账号的密码确认。"
          onPassword={async (pw) => {
            if (!(await checkPassword(current, pw))) return '密码不正确，请重新输入。';
            setSaved(current, false);
            setUnsave(false);
            return null;
          }} />
      )}
      {confirmAll && (
        <ConfirmSheet title="退出全部账号" text={`这台设备上的 ${accounts.length} 个账号都会退出，下次使用需要重新输入密码。`} confirm="退出全部"
          onClose={() => setConfirmAll(false)}
          onConfirm={async () => {
            await signOutAll();
            queryClient.clear();
            setConfirmAll(false);
            router.replace('/login');
          }} />
      )}
    </div>
  );
}
