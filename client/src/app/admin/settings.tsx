import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DatePicker, Desk, FormLoading, SkeletonGroup, Icon, Notice, today, type IconName } from '@/components';
import { AppError, explain } from '@/lib/errors';
import { call } from '@/lib/rpc';
import { supabase } from '@/lib/supabase';

type Values = Record<string, unknown>;
type Limit = { junior: number; primary: number };
type Problem = { title: string; text: string } | null;

const failure = (e: unknown) => (e instanceof AppError ? explain(e.code, e.detail) : explain(''));
const digits = (v: string) => v.replace(/\D/g, '').slice(0, 7);

// The notes the bank can print; 1 is always one of them (the counter makes change with it).
const FACES = [1, 2, 5, 10, 20, 50, 100];
const pad = (n: number) => String(n).padStart(2, '0');

function Field({ icon, label, hint, children }: { icon: IconName; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="dc-field">
      <span className="dc-field-label"><Icon name={icon} />{label}</span>
      {children}
      {hint && <span className="dc-field-hint">{hint}</span>}
    </div>
  );
}

// QtyStepper control (design system): minus, the number (typed or stepped) and plus, kept within min and max.
function Stepper({ label, value, onChange, step, min, max }: {
  label: string; value: string; onChange: (v: string) => void; step: number; min: number; max?: number;
}) {
  const n = Number(value);
  const to = (v: number) => onChange(String(Math.min(max ?? Infinity, Math.max(min, v))));
  return (
    <div className="dc-qty-ctrl">
      <button className="dc-qty-btn" type="button" aria-label={`${label}减少 ${step}`} disabled={n <= min} onClick={() => to(n - step)}><Icon name="minus" /></button>
      <input className="dc-qty-input" inputMode="numeric" aria-label={label} value={value} onChange={(e) => onChange(digits(e.target.value))} />
      <button className="dc-qty-btn" type="button" aria-label={`${label}增加 ${step}`} disabled={max != null && n >= max} onClick={() => to(n + step)}><Icon name="plus" /></button>
    </div>
  );
}

// One limit for both divisions: a QtyStepper card each, in the two-column grid the counter uses for notes.
function LimitPair({ label, hint, primary, junior }: {
  label: string; hint?: string; primary: [string, (v: string) => void]; junior: [string, (v: string) => void];
}) {
  return (
    <Field icon="withdraw" label={`${label}（HTB）`} hint={hint}>
      <div className="dc-denoms">
        {([['小学部', primary], ['初中部', junior]] as const).map(([name, [value, set]]) => (
          <div key={name} className="dc-qty">
            <div className="dc-qty-head"><span className="dc-qty-face" style={{ fontSize: 18 }}>{name}</span></div>
            <Stepper label={`${name}${label}`} value={value} onChange={set} step={10} min={1} />
          </div>
        ))}
      </div>
    </Field>
  );
}

// Toast (design system): one short result for 3 seconds. Rendered at the end of <body> in its own viewport-sized
// .dc-app, as ConfirmSheet is, so it stays in the viewport corner; the wrapper lets clicks through.
function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
    // Not onDone: it is a new function on every render and would restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return createPortal(
    <div className="dc-app" style={{ position: 'fixed', inset: 0, zIndex: 20, minHeight: 0, background: 'none', pointerEvents: 'none' }}>
      <div className="dc-toasts" role="status"><div className="dc-toast is-success"><Icon name="success" />{text}</div></div>
    </div>,
    document.body,
  );
}

// 参数 (teacher): the settings of PHASE-1.md §5.3. 排名匿名 takes effect when switched; the rest is saved together.
export default function Settings() {
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('key,value');
      if (error) throw error;
      return Object.fromEntries(data.map((r) => [r.key, r.value])) as Values;
    },
  });
  return (
    <Desk title="参数">
      {settings.error ? <Notice tone="danger" title="暂时无法读取参数">请检查网络后刷新页面。</Notice>
        : !settings.data ? <SkeletonGroup className="dc-split"><FormLoading fields={5} /><FormLoading fields={2} /></SkeletonGroup>
        : <SettingsForm saved={settings.data} />}
    </Desk>
  );
}

function SettingsForm({ saved }: { saved: Values }) {
  const queryClient = useQueryClient();
  const single = saved.withdraw_single_limit as Limit;
  const daily = saved.withdraw_daily_limit as Limit;
  const [faces, setFaces] = useState(saved.denominations as number[]);
  const [singlePrimary, setSinglePrimary] = useState(String(single.primary));
  const [singleJunior, setSingleJunior] = useState(String(single.junior));
  const [dailyPrimary, setDailyPrimary] = useState(String(daily.primary));
  const [dailyJunior, setDailyJunior] = useState(String(daily.junior));
  const [rankingSize, setRankingSize] = useState(String(saved.ranking_size));
  const pay = saved.salary_per_shift as { am: number; pm: number };
  const [payAm, setPayAm] = useState(String(pay.am));
  const [payPm, setPayPm] = useState(String(pay.pm));
  const [promoMonth, promoDay] = String(saved.promotion_date).split('-').map(Number);
  const [month, setMonth] = useState(promoMonth);
  const [day, setDay] = useState(promoDay);
  const [anonymous, setAnonymous] = useState(saved.ranking_anonymous === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Problem>(null);
  const [toast, setToast] = useState<string | null>(null);

  // The values as set_settings takes them; the server checks each one and saves all or none. Limits list junior
  // first, the key order jsonb returns, so unchanged ones compare equal.
  const days = new Date(Date.UTC(2001, month, 0)).getUTCDate(); // a common year: no 29 February
  const next: Values = {
    denominations: [...faces].sort((a, b) => a - b),
    withdraw_single_limit: { junior: Number(singleJunior), primary: Number(singlePrimary) },
    withdraw_daily_limit: { junior: Number(dailyJunior), primary: Number(dailyPrimary) },
    ranking_size: Number(rankingSize),
    salary_per_shift: { am: Number(payAm), pm: Number(payPm) },
    promotion_date: `${pad(month)}-${pad(Math.min(day, days))}`,
  };
  const allFaces = [...new Set([...FACES, ...(saved.denominations as number[])])].sort((a, b) => a - b);
  const toggleFace = (f: number) => setFaces(faces.includes(f) ? faces.filter((x) => x !== f) : [...faces, f]);
  const changed = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(saved[k]));

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['settings'] }),
    queryClient.invalidateQueries({ queryKey: ['counter-settings'] }),
  ]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || !changed.length) return;
    setBusy(true);
    setError(null);
    try {
      await call('set_settings', { p_values: Object.fromEntries(changed.map((k) => [k, next[k]])) });
      setToast('参数已保存');
    } catch (err) {
      setError(failure(err));
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function switchAnonymous(on: boolean) {
    setAnonymous(on);
    setBusy(true);
    setError(null);
    try {
      await call('set_setting', { p_key: 'ranking_anonymous', p_value: on });
      setToast('设置已保存');
    } catch (err) {
      setAnonymous(!on);
      setError(failure(err));
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  return (
    <form className="dc-stack dc-enter" onSubmit={save} noValidate aria-label="参数">
      {error && <Notice tone="danger" title={error.title}>{error.text}</Notice>}
      <div className="dc-split">
        <div className="dc-stack">
          <div>
            <p className="dc-list-title">柜台</p>
            <div className="dc-card dc-stack">
              <Field icon="coin" label="面额（元）" hint="柜台点钞按这些面额录入；1 元必须保留">
                <div className="dc-chips" role="group" aria-label="面额">
                  {allFaces.map((f) => (
                    <button key={f} className="dc-chip" type="button" aria-pressed={faces.includes(f)} disabled={f === 1}
                      onClick={() => toggleFace(f)}><Icon name="check" />{f} 元</button>
                  ))}
                </div>
              </Field>
              <LimitPair label="单笔取款上限" primary={[singlePrimary, setSinglePrimary]} junior={[singleJunior, setSingleJunior]} />
              <LimitPair label="单日取款上限" hint="当天累计，不含已冲正的取款" primary={[dailyPrimary, setDailyPrimary]} junior={[dailyJunior, setDailyJunior]} />
            </div>
          </div>
        </div>
        <div className="dc-stack">
          <div>
            <p className="dc-list-title">排名</p>
            <ul className="dc-list">
              <li>
                <label className="dc-switch">
                  <span className="dc-switch-text"><b>排名匿名</b><small>开启后排名中的姓名显示为「张*明」</small></span>
                  <input type="checkbox" role="switch" checked={anonymous} disabled={busy} onChange={(e) => switchAnonymous(e.target.checked)} />
                  <span className="dc-switch-track" />
                </label>
              </li>
              <li>
                <Field icon="ranking" label="排名人数（名）" hint="每个学部显示前几名，1 到 100">
                  <Stepper label="排名人数" value={rankingSize} onChange={(v) => setRankingSize(v.slice(0, 3))} step={1} min={1} max={100} />
                </Field>
              </li>
            </ul>
          </div>
          <div>
            <p className="dc-list-title">考勤</p>
            <div className="dc-card dc-stack">
              {([['中午班', '13:30 之前', payAm, setPayAm], ['下午班', '13:30 起', payPm, setPayPm]] as const).map(([name, when, value, set]) => (
                <Field key={name} icon="coin" label={`${name}工资（HTB）`} hint={`${when}的有效班次，每个 1 到 10000 HTB；发放时按当时的金额计算`}>
                  <Stepper label={`${name}工资`} value={value} onChange={(v) => set(v.slice(0, 5))} step={1} min={1} max={10000} />
                </Field>
              ))}
            </div>
          </div>
          <div>
            <p className="dc-list-title">学年</p>
            <div className="dc-card">
              {/* Only the month and day count; the calendar shows them in this year, and 29 February becomes the 28th. */}
              <DatePicker label="升年级日期" value={`${today().slice(0, 4)}-${pad(month)}-${pad(Math.min(day, days))}`}
                shown={`${month}月${Math.min(day, days)}日`} rule="每年从这天起，所有学生的年级加一"
                onChange={(d) => { const [m, dd] = d.slice(5).split('-').map(Number); setMonth(m); setDay(m === 2 ? Math.min(dd, 28) : dd); }} />
              <p className="dc-top-sub" style={{ margin: 'var(--space-2) 0 0' }}>每年从这天起，所有学生的年级加一</p>
            </div>
          </div>
        </div>
      </div>
      <div className="dc-actions">
        <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="submit" disabled={busy || !changed.length}>
          {busy ? '正在保存' : '保存参数'}
        </button>
      </div>
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </form>
  );
}
