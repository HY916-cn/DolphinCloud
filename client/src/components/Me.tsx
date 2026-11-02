import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { checkPassword, savedAccounts, setSaved, signOutAll, switchAccount, type SavedAccount } from '@/lib/accounts';
import { ROLES, type Me } from '@/lib/session';
import { ConfirmSheet, SignOut } from './Sheet';
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

// 我的 (every login): who is signed in, the accounts on this device and switching between them, 在此设备保存登录,
// adding an account and signing out.
export function MeView({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const [, refresh] = useState(0);
  const [ask, setAsk] = useState<SavedAccount | null>(null);
  const [password, setPassword] = useState<SavedAccount | null>(null);
  const [unsave, setUnsave] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const accounts = savedAccounts();
  const mine = accounts.find((a) => a.id === me.profile.id);
  const s = me.student;

  const switched = () => { queryClient.clear(); router.replace('/'); };
  async function trySwitch(a: SavedAccount) {
    setAsk(null);
    const r = await switchAccount(a.id);
    if (!r) return switched();
    if (r === 'password') return setPassword(a);
    setProblem(SWITCH_ERRORS[r] ?? '暂时无法切换，请检查网络后重试。');
  }

  return (
    <div className="dc-split">
      <div className="dc-stack dc-enter">
        <div className="dc-person">
          <span className="dc-person-avatar"><Icon name={s ? 'me' : 'teacher'} /></span>
          <div className="dc-person-main">
            <div className="dc-person-name">{s?.name ?? me.profile.display_name}</div>
            <div className="dc-person-meta">
              {s ? <><span>{s.class_label ?? `${s.class_no} 班`}</span> · <span>{s.cohort} 届</span> · <span>学号 {s.student_no}</span></>
                : <><span>{me.roles.map((r) => ROLES[r]).join('、') || '未分配身份'}</span> · <span>账号 {me.profile.login_id}</span></>}
            </div>
          </div>
        </div>
        <ul className="dc-list">
          <li>
            <label className="dc-switch">
              <span className="dc-switch-text"><b>在此设备保存登录</b>
                <small>{mine?.saved ? '在这台设备上切换回这个账号不用输入密码' : '切换回这个账号时需要输入密码'}</small></span>
              <input type="checkbox" role="switch" checked={!!mine?.saved}
                onChange={(e) => (e.target.checked ? (setSaved(me.profile.id, true), refresh((n) => n + 1)) : setUnsave(true))} />
              <span className="dc-switch-track" />
            </label>
          </li>
        </ul>
        <p className="dc-top-sub" style={{ margin: '0 var(--space-2)' }}>需要更换密码时，请联系银行管理员重置。</p>
      </div>
      <div className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties}>
        <div>
          <p className="dc-list-title">本机账号</p>
          {problem && <Notice tone="danger" title="无法切换">{problem}</Notice>}
          <ul className="dc-list" aria-label="本机账号">
            {accounts.map((a) => {
              const current = a.id === me.profile.id;
              const body = (
                <>
                  <span className="dc-list-icon"><Icon name={a.kind === 'student' ? 'me' : 'teacher'} /></span>
                  <span>{a.name}<small className="dc-top-sub">{who(a)}{!current && !(a.saved && a.session) && ' · 需要输入密码'}</small></span>
                  {current ? <small className="dc-top-sub">当前</small> : <Icon name="next" />}
                </>
              );
              return (
                <li key={a.id}>
                  {current ? <div className="dc-list-link" aria-current="true">{body}</div> : (
                    <a className="dc-list-link" href="/" onClick={(e) => {
                      e.preventDefault();
                      setProblem(null);
                      if (a.saved && a.session) setAsk(a);
                      else setPassword(a);
                    }}>{body}</a>
                  )}
                </li>
              );
            })}
            <li>
              <a className="dc-list-link" {...link('/login?add=1')}>
                <span className="dc-list-icon"><Icon name="plus" /></span><span>添加账号</span><Icon name="next" />
              </a>
            </li>
          </ul>
        </div>
        <ul className="dc-list">
          <li>
            <SignOut trigger={(open) => (
              <a className="dc-list-link is-danger" href="#" role="button" onClick={(e) => { e.preventDefault(); open(); }}>
                <span className="dc-list-icon"><Icon name="logout" /></span><span>退出当前账号</span><Icon name="next" />
              </a>
            )} />
          </li>
          {accounts.length > 1 && (
            <li>
              <a className="dc-list-link is-danger" href="#" role="button" onClick={(e) => { e.preventDefault(); setConfirmAll(true); }}>
                <span className="dc-list-icon"><Icon name="logout" /></span><span>退出全部账号</span><Icon name="next" />
              </a>
            </li>
          )}
        </ul>
      </div>

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
      {unsave && (
        <PasswordSheet title="不再在此设备保存登录？" confirm="确认关闭" onClose={() => setUnsave(false)}
          text="关闭后，从其他账号切换回这个账号时需要输入密码。请输入当前账号的密码确认。"
          onPassword={async (pw) => {
            if (!(await checkPassword(me.profile.id, pw))) return '密码不正确，请重新输入。';
            setSaved(me.profile.id, false);
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
            router.replace('/login');
          }} />
      )}
    </div>
  );
}
