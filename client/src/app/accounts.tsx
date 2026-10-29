import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ConfirmSheet, Gate, Icon, link, Notice, SignOut, Welcome } from '@/components';
import { savedAccounts, signOutAll, switchAccount, type SavedAccount } from '@/lib/accounts';

// 本机账号 (PHASE-1.md §7.4): the accounts signed in on this device; tap one and confirm who you are to switch, add
// another, sign out one or all.
export default function Accounts() {
  const queryClient = useQueryClient();
  const [expired, setExpired] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [ask, setAsk] = useState<SavedAccount | null>(null);
  const count = savedAccounts().length;
  return (
    <Gate allow={() => true}>
      {(me) => (
        <Welcome label="本机账号">
          <h2 className="dc-login-title">本机账号</h2>
          {expired && <Notice tone="danger" title={`${expired}需要重新登录`}>请点「添加账号」重新输入密码。</Notice>}
          <ul className="dc-list">
            {savedAccounts().map((a) => {
              const current = a.id === me.profile.id;
              const body = (
                <>
                  <span className="dc-list-icon"><Icon name={a.kind === 'student' ? 'me' : 'teacher'} /></span>
                  <span>{a.name}<small className="dc-top-sub">{a.kind === 'student' ? `学号 ${a.loginId}` : `工作账号 ${a.loginId}`}</small></span>
                  {current ? <small className="dc-top-sub">当前</small> : <Icon name="next" />}
                </>
              );
              return (
                <li key={a.id}>
                  {current ? <div className="dc-list-link" aria-current="true">{body}</div> : (
                    <a className="dc-list-link" href="/" onClick={(e) => { e.preventDefault(); setAsk(a); }}>{body}</a>
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
          <a className="dc-btn dc-btn-secondary dc-btn-block" {...link('/')}>返回</a>
          <SignOut trigger={(open) => (
            <button className="dc-btn dc-btn-ghost dc-btn-sm dc-btn-block" type="button" onClick={open}>退出当前账号</button>
          )} />
          {count > 1 && (
            <button className="dc-btn dc-btn-ghost dc-btn-sm dc-btn-block is-danger" type="button" onClick={() => setConfirmAll(true)}>退出全部账号</button>
          )}
          {ask && (
            <ConfirmSheet title={`你是${ask.name}吗？`} cancel="不是" confirm="是，切换"
              text={`确定后切换到${ask.kind === 'student' ? `学号 ${ask.loginId}` : `工作账号 ${ask.loginId}`}。`}
              onClose={() => setAsk(null)}
              onConfirm={async () => {
                const a = ask;
                setAsk(null);
                if (!(await switchAccount(a.id))) return setExpired(a.name);
                queryClient.clear();
                router.replace('/');
              }} />
          )}
          {confirmAll && (
            <ConfirmSheet title="退出全部账号" text={`这台设备上的 ${count} 个账号都会退出，下次使用需要重新输入密码。`} confirm="退出全部"
              onClose={() => setConfirmAll(false)}
              onConfirm={async () => {
                await signOutAll();
                queryClient.clear();
                router.replace('/login');
              }} />
          )}
        </Welcome>
      )}
    </Gate>
  );
}
