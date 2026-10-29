import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Desk, FormLoading, Icon, Notice, type IconName } from '@/components';
import { AppError, explain } from '@/lib/errors';
import { call } from '@/lib/rpc';
import { supabase } from '@/lib/supabase';

type Values = Record<string, unknown>;
type Limit = { junior: number; primary: number };
type Problem = { title: string; text: string } | null;

const failure = (e: unknown) => (e instanceof AppError ? explain(e.code, e.detail) : explain(''));
const digits = (v: string) => v.replace(/\D/g, '').slice(0, 7);

function Field({ icon, label, hint, unit, children }: { icon: IconName; label: string; hint?: string; unit?: string; children: ReactNode }) {
  return (
    <label className="dc-field">
      <span className="dc-field-label"><Icon name={icon} />{label}</span>
      <span className="dc-input-wrap">{children}{unit && <span className="dc-input-unit">{unit}</span>}</span>
      {hint && <span className="dc-field-hint">{hint}</span>}
    </label>
  );
}

// Toast (design system): one short result for 3 seconds. Rendered at the end of <body> in its own viewport-sized
// .dc-app, as ConfirmSheet is, so it stays in the viewport corner; the wrapper lets clicks through.
function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [text]); // not onDone: it is a new function on every render and would restart the timer
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
        : !settings.data ? <div className="dc-split"><FormLoading fields={5} /><FormLoading fields={2} /></div>
        : <SettingsForm saved={settings.data} />}
    </Desk>
  );
}

function SettingsForm({ saved }: { saved: Values }) {
  const queryClient = useQueryClient();
  const single = saved.withdraw_single_limit as Limit;
  const daily = saved.withdraw_daily_limit as Limit;
  const [faces, setFaces] = useState((saved.denominations as number[]).join(', '));
  const [singlePrimary, setSinglePrimary] = useState(String(single.primary));
  const [singleJunior, setSingleJunior] = useState(String(single.junior));
  const [dailyPrimary, setDailyPrimary] = useState(String(daily.primary));
  const [dailyJunior, setDailyJunior] = useState(String(daily.junior));
  const [rankingSize, setRankingSize] = useState(String(saved.ranking_size));
  const [promotion, setPromotion] = useState(String(saved.promotion_date));
  const [anonymous, setAnonymous] = useState(saved.ranking_anonymous === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Problem>(null);
  const [toast, setToast] = useState<string | null>(null);

  // The values as set_setting takes them; the server checks each one (a face that is not a whole number goes as
  // null and is refused). Limits list junior first, the key order jsonb returns, so unchanged ones compare equal.
  const next: Values = {
    denominations: faces.split(/[\s,，、]+/).filter(Boolean).map(Number).sort((a, b) => a - b),
    withdraw_single_limit: { junior: Number(singleJunior), primary: Number(singlePrimary) },
    withdraw_daily_limit: { junior: Number(dailyJunior), primary: Number(dailyPrimary) },
    ranking_size: Number(rankingSize),
    promotion_date: promotion.trim(),
  };
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
      for (const key of changed) await call('set_setting', { p_key: key, p_value: next[key] });
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
              <Field icon="coin" label="面额" unit="元" hint="用逗号分隔，必须包含 1，例如 1, 2, 5, 10">
                <input className="dc-input" value={faces} onChange={(e) => setFaces(e.target.value)} />
              </Field>
              <Field icon="withdraw" label="单笔取款上限 · 小学部" unit="HTB">
                <input className="dc-input" inputMode="numeric" value={singlePrimary} onChange={(e) => setSinglePrimary(digits(e.target.value))} />
              </Field>
              <Field icon="withdraw" label="单笔取款上限 · 初中部" unit="HTB">
                <input className="dc-input" inputMode="numeric" value={singleJunior} onChange={(e) => setSingleJunior(digits(e.target.value))} />
              </Field>
              <Field icon="withdraw" label="单日取款上限 · 小学部" unit="HTB" hint="当天累计，不含已冲正的取款">
                <input className="dc-input" inputMode="numeric" value={dailyPrimary} onChange={(e) => setDailyPrimary(digits(e.target.value))} />
              </Field>
              <Field icon="withdraw" label="单日取款上限 · 初中部" unit="HTB" hint="当天累计，不含已冲正的取款">
                <input className="dc-input" inputMode="numeric" value={dailyJunior} onChange={(e) => setDailyJunior(digits(e.target.value))} />
              </Field>
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
                <Field icon="ranking" label="排名人数" unit="名" hint="每个学部显示前几名，1 到 100">
                  <input className="dc-input" inputMode="numeric" value={rankingSize} onChange={(e) => setRankingSize(digits(e.target.value).slice(0, 3))} />
                </Field>
              </li>
            </ul>
          </div>
          <div>
            <p className="dc-list-title">学年</p>
            <div className="dc-card">
              <Field icon="calendar" label="升年级日期" hint="月-日，例如 09-01；从这天起所有学生的年级加一">
                <input className="dc-input" inputMode="numeric" value={promotion} maxLength={5} placeholder="09-01" onChange={(e) => setPromotion(e.target.value)} />
              </Field>
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
