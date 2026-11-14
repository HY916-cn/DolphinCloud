import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { DatePicker, Desk, FormLoading, SkeletonGroup, Icon, Notice, outside, Stepper, today, Toast, useWide, type IconName, type Range } from '@/components';
import { SHIFTS, useSalaryRates } from '@/lib/attendance';
import {
  curveDraft, curveProblems, preview, ruleProblem, RULES, rulesDraft, rulesValue, type Curve, type CurveDraft, type Rules,
} from '@/lib/credit';
import { AppError, explain } from '@/lib/errors';
import { rateDraft, rateProblems, rateValues, type AnchorParams, type RateDraft } from '@/lib/rates';
import { call } from '@/lib/rpc';
import { PAID_ROLES, rateWrong, ratesDraft, ratesValue, type Rates, type RatesDraft } from '@/lib/salary';
import { ROLES } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type Values = Record<string, unknown>;
type Limit = { junior: number; primary: number };
type Problem = { title: string; text: string } | null;

const failure = (e: unknown) => (e instanceof AppError ? explain(e.code, e.detail) : explain(''));

// The notes the bank can print; 1 is always one of them (the counter makes change with it).
const FACES = [1, 2, 5, 10, 20, 50, 100];
const pad = (n: number) => String(n).padStart(2, '0');

// The numbers set_settings takes; an empty or out-of-range one is said so here and never saved.
const LIMIT: Range = { min: 1, max: 1_000_000 };
const RANKING: Range = { min: 1, max: 100 };
const allowed = ({ min, max }: Range) => `请输入 ${min} 到 ${max} 的整数`;
const MIN_SCORE: Range = { min: 0, max: 999 };
const CREDIT_LIMIT: Range = { min: 1, max: 10_000 };
const RULE: Range = { min: 0, max: 100 };
// A value as jsonb keeps it: an object's keys in any order compare equal.
const stable = (v: unknown) => JSON.stringify(v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v);

function Field({ icon, label, hint, error, children }: { icon: IconName; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className={`dc-field ${error ? 'is-error' : ''}`}>
      <span className="dc-field-label"><Icon name={icon} />{label}</span>
      {children}
      {(error || hint) && <span className="dc-field-hint">{error ? <><Icon name="warning" />{error}</> : hint}</span>}
    </div>
  );
}

// 信用分 (design system data.md 参数页分组): 分数与额度, 系数, a preview of what the values being edited give, and the
// points of each rule, unsigned (a loss is saved negative). Every value is checked here as set_setting checks it.
function CreditGroup({ curve, problems, onCurve, rules, onRule }: {
  curve: CurveDraft; problems: Partial<Record<keyof Curve, string>>; onCurve: (k: keyof Curve, v: string) => void;
  rules: Record<keyof Rules, string>; onRule: (k: keyof Rules, v: string) => void;
}) {
  const limitError = problems.limit_min ?? problems.limit_max;
  const ok = !Object.keys(problems).length;
  const rows = ok ? preview(Object.fromEntries(Object.entries(curve).map(([k, v]) => [k, Number(v)])) as Curve) : null;
  const factor = (key: keyof Curve, label: string) => (
    <label className={`dc-field ${problems[key] ? 'is-error' : ''}`}>
      <span className="dc-field-label"><Icon name="gauge" />{label}</span>
      <span className="dc-input-wrap">
        <span className="dc-input-unit">×</span>
        <input className="dc-input" inputMode="decimal" aria-label={label} value={curve[key]}
          onChange={(e) => onCurve(key, e.target.value.replace(/[^\d.]/g, '').slice(0, 7))} />
      </span>
      {problems[key] && <span className="dc-field-hint"><Icon name="warning" />{problems[key]}</span>}
    </label>
  );
  return (
    <section className="dc-stack">
      <h2 className="heading is-section">信用分</h2>
      <div className="dc-card dc-stack">
        <p className="dc-list-title">分数与额度</p>
        <Field icon="gauge" label="能贷款的最低分（分）" hint="0 到 999" error={problems.min_score}>
          <Stepper label="能贷款的最低分" value={curve.min_score} onChange={(v) => onCurve('min_score', v.slice(0, 4))} step={10} range={MIN_SCORE} />
        </Field>
        <Field icon="coin" label="贷款额度（HTB）" hint="1 到 10000" error={limitError}>
          <div className="dc-denoms">
            {([['limit_min', '最低分时'], ['limit_max', '1000 分时']] as const).map(([key, name]) => (
              <div key={key} className="dc-qty is-product">
                <div className="dc-qty-head"><span className="dc-qty-name">{name}</span></div>
                <Stepper label={`${name}的额度`} value={curve[key]} onChange={(v) => onCurve(key, v.slice(0, 5))} step={5} range={CREDIT_LIMIT}
                  invalid={!!problems[key]} />
              </div>
            ))}
          </div>
        </Field>
        <Field icon="coin" label="取整单位（HTB）" hint="额度向下取整到它的倍数，不大于最低分时的额度" error={problems.limit_step}>
          <Stepper label="取整单位" value={curve.limit_step} onChange={(v) => onCurve('limit_step', v.slice(0, 5))} step={1} range={CREDIT_LIMIT}
            invalid={!!problems.limit_step} />
        </Field>
        <p className="dc-list-title">系数</p>
        <div className="dc-denoms">
          {factor('loan_max', '最低分时的贷款系数')}
          {factor('loan_min', '1000 分时的贷款系数')}
          {factor('saving_min', '0 分时的储蓄系数')}
          {factor('saving_max', '1000 分时的储蓄系数')}
        </div>
        <p className="dc-list-title">按当前填写预览</p>
        <div className="dc-table-scroll">
          <table className="dc-table" aria-label="按当前填写预览">
            <thead><tr><th scope="col">分数</th><th scope="col" className="n">额度</th><th scope="col" className="n">贷款系数</th><th scope="col" className="n">储蓄系数</th></tr></thead>
            <tbody>
              {(rows ?? [400, 600, 800, 1000].map((score) => ({ score, limit: undefined, loan: undefined, saving: undefined }))).map((r) => (
                <tr key={r.score}>
                  <td>{r.score} 分</td>
                  <td className="n">{r.limit === undefined ? '—' : r.limit === null ? '不能贷款' : `${r.limit} HTB`}</td>
                  <td className="n">{r.loan == null ? '—' : `×${r.loan}`}</td>
                  <td className="n">{r.saving === undefined ? '—' : `×${r.saving}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dc-list-title">加减分规则</p>
        {RULES.map((r) => {
          const wrong = ruleProblem(rules[r.key]);
          return (
            <div key={r.key} className={`dc-field ${wrong ? 'is-error' : ''}`}>
              <div className="dc-section-head">
                <span>{r.event}<small className="dc-top-sub" style={{ display: 'block' }}>{r.when}</small></span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 'none', width: 200 }}>
                  {r.loss ? '减' : '加'}
                  <span style={{ flex: 1 }}>
                    <Stepper label={`${r.event}${r.loss ? '减' : '加'}的分`} value={rules[r.key]} onChange={(v) => onRule(r.key, v.slice(0, 3))} step={1} range={RULE} />
                  </span>
                </span>
              </div>
              {wrong && <span className="dc-field-hint"><Icon name="warning" />{wrong}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// 考勤与工资 (design system data.md 参数页分组): the 工资标准, identity × shift, saved whole with set_salary_rates. A
// table on a computer; a card per identity, its two shifts side by side, on phones and tablets.
function SalaryGroup({ draft, onChange }: { draft: RatesDraft; onChange: (role: keyof RatesDraft, shift: 'am' | 'pm', v: string) => void }) {
  const wide = useWide();
  const cell = (role: keyof RatesDraft, shift: 'am' | 'pm', label?: string) => {
    const wrong = rateWrong(draft[role][shift]);
    return (
      <label className={`dc-field ${wrong ? 'is-error' : ''}`}>
        {label && <span className="dc-field-label"><Icon name="coin" />{label}</span>}
        <span className="dc-input-wrap">
          <input className="dc-input" inputMode="numeric" aria-label={`${ROLES[role]}${SHIFTS[shift]}工资`} value={draft[role][shift]}
            onChange={(e) => onChange(role, shift, e.target.value.replace(/\D/g, '').slice(0, 5))} />
          <span className="dc-input-unit">HTB</span>
        </span>
        {wrong && <span className="dc-field-hint"><Icon name="warning" />工资标准每格 1～10000 HTB。</span>}
      </label>
    );
  };
  return (
    <section className="dc-stack">
      <h2 className="heading is-section">考勤与工资</h2>
      <p className="dc-caption">每个有效班次按身份发工资，从下一次发放起生效。运维员不参与考勤。</p>
      {wide ? (
        <div className="dc-card">
          <table className="dc-table" aria-label="工资标准">
            <thead><tr><th scope="col">身份</th><th scope="col">{SHIFTS.am}</th><th scope="col">{SHIFTS.pm}</th></tr></thead>
            <tbody>
              {PAID_ROLES.map((role) => (
                <tr key={role}><th scope="row">{ROLES[role]}</th><td>{cell(role, 'am')}</td><td>{cell(role, 'pm')}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : PAID_ROLES.map((role) => (
        <div key={role} className="dc-card dc-stack" role="group" aria-label={`${ROLES[role]}的工资标准`}>
          <p className="dc-list-title">{ROLES[role]}</p>
          <div className="dc-denoms">{cell(role, 'am', SHIFTS.am)}{cell(role, 'pm', SHIFTS.pm)}</div>
        </div>
      ))}
    </section>
  );
}

// A percentage with up to 2 decimals typed in a Field, "%" after it.
function Percent({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <label className={`dc-field ${error ? 'is-error' : ''}`}>
      <span className="dc-field-label"><Icon name="rate" />{label}</span>
      <span className="dc-input-wrap">
        <input className="dc-input" inputMode="decimal" aria-label={label} value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, '').slice(0, 6))} />
        <span className="dc-input-unit">%</span>
      </span>
      {error && <span className="dc-field-hint"><Icon name="warning" />{error}</span>}
    </label>
  );
}

// 利率 (design system data.md 参数页分组): the anchor's start and bounds; the rest is fixed and shown on 利率.
function RateGroup({ draft, problems, onChange }: {
  draft: RateDraft; problems: Partial<RateDraft>; onChange: (k: keyof RateDraft, v: string) => void;
}) {
  return (
    <section className="dc-stack">
      <h2 className="heading is-section">利率</h2>
      <p className="dc-caption">从下周一起生效。其余计算参数由系统固定，可在利率页查看。</p>
      <div className="dc-card dc-stack">
        <div className="dc-denoms">
          {([['initial', '初始锚点'], ['min', '锚点下限'], ['max', '锚点上限']] as const).map(([key, label]) => (
            <Percent key={key} label={label} value={draft[key]} onChange={(v) => onChange(key, v)} error={problems[key]} />
          ))}
        </div>
      </div>
    </section>
  );
}

// One limit for both divisions: a QtyStepper card each, in the two-column grid the counter uses for notes.
function LimitPair({ label, hint, primary, junior }: {
  label: string; hint?: string; primary: [string, (v: string) => void]; junior: [string, (v: string) => void];
}) {
  return (
    <Field icon="withdraw" label={`${label}（HTB）`} hint={hint} error={outside(primary[0], LIMIT) || outside(junior[0], LIMIT) ? allowed(LIMIT) : undefined}>
      <div className="dc-denoms">
        {([['小学部', primary], ['初中部', junior]] as const).map(([name, [value, set]]) => (
          <div key={name} className="dc-qty is-product">
            <div className="dc-qty-head"><span className="dc-qty-name">{name}</span></div>
            <Stepper label={`${name}${label}`} value={value} onChange={set} step={10} range={LIMIT} />
          </div>
        ))}
      </div>
    </Field>
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
  const rates = useSalaryRates();
  return (
    <Desk title="参数">
      {settings.error || rates.error || rates.data === null ? <Notice tone="danger" title="暂时无法读取参数">请检查网络后刷新页面。</Notice>
        : !settings.data || !rates.data ? <SkeletonGroup className="dc-split"><FormLoading fields={5} /><FormLoading fields={2} /></SkeletonGroup>
        : <SettingsForm saved={settings.data} savedRates={rates.data} />}
    </Desk>
  );
}

function SettingsForm({ saved, savedRates }: { saved: Values; savedRates: Rates }) {
  const queryClient = useQueryClient();
  const single = saved.withdraw_single_limit as Limit;
  const daily = saved.withdraw_daily_limit as Limit;
  const [faces, setFaces] = useState(saved.denominations as number[]);
  const [singlePrimary, setSinglePrimary] = useState(String(single.primary));
  const [singleJunior, setSingleJunior] = useState(String(single.junior));
  const [dailyPrimary, setDailyPrimary] = useState(String(daily.primary));
  const [dailyJunior, setDailyJunior] = useState(String(daily.junior));
  const [rankingSize, setRankingSize] = useState(String(saved.ranking_size));
  const [pay, setPay] = useState(() => ratesDraft(savedRates));
  const [promoMonth, promoDay] = String(saved.promotion_date).split('-').map(Number);
  const [month, setMonth] = useState(promoMonth);
  const [day, setDay] = useState(promoDay);
  const [anonymous, setAnonymous] = useState(saved.ranking_anonymous === true);
  const [curve, setCurve] = useState(() => curveDraft(saved.credit_curve as Curve));
  const [rules, setRules] = useState(() => rulesDraft(saved.credit_rules as Rules));
  const [rates, setRates] = useState(() => rateDraft(saved.anchor_params as AnchorParams));
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
    promotion_date: `${pad(month)}-${pad(Math.min(day, days))}`,
    credit_curve: Object.fromEntries(Object.entries(curve).map(([k, v]) => [k, Number(v)])),
    credit_rules: rulesValue(rules),
    anchor_params: rateValues(rates, saved.anchor_params as AnchorParams),
  };
  const curveWrong = curveProblems(curve);
  const ratesWrong = rateProblems(rates);
  const allFaces = [...new Set([...FACES, ...(saved.denominations as number[])])].sort((a, b) => a - b);
  const toggleFace = (f: number) => setFaces(faces.includes(f) ? faces.filter((x) => x !== f) : [...faces, f]);
  const changed = Object.keys(next).filter((k) => stable(next[k]) !== stable(saved[k]));
  const nextRates = ratesValue(pay);
  const ratesChanged = !!nextRates && JSON.stringify(nextRates) !== JSON.stringify(ratesValue(ratesDraft(savedRates)));
  const invalid = ([[singlePrimary, LIMIT], [singleJunior, LIMIT], [dailyPrimary, LIMIT], [dailyJunior, LIMIT], [rankingSize, RANKING]] as const)
    .some(([value, range]) => outside(value, range)) || Object.keys(curveWrong).length > 0 || Object.values(rules).some((v) => ruleProblem(v))
    || Object.keys(ratesWrong).length > 0 || !nextRates;

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['settings'] }),
    queryClient.invalidateQueries({ queryKey: ['counter-settings'] }),
    queryClient.invalidateQueries({ queryKey: ['salary_rates'] }),
  ]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || invalid || !(changed.length || ratesChanged)) return;
    setBusy(true);
    setError(null);
    try {
      if (changed.length) await call('set_settings', { p_values: Object.fromEntries(changed.map((k) => [k, next[k]])) });
      if (ratesChanged) await call('set_salary_rates', { p_rates: nextRates });
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
      <section className="dc-stack">
        <h2 className="heading is-section">柜台</h2>
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
          <LimitPair label="单日取款上限" hint="当天累计" primary={[dailyPrimary, setDailyPrimary]} junior={[dailyJunior, setDailyJunior]} />
        </div>
      </section>
      <section className="dc-stack">
        <h2 className="heading is-section">排名</h2>
        <ul className="dc-list">
          <li>
            <label className="dc-switch">
              <span className="dc-switch-text"><b>排名匿名</b><small>开启后排名中的姓名显示为「张*明」</small></span>
              <input type="checkbox" role="switch" checked={anonymous} disabled={busy} onChange={(e) => switchAnonymous(e.target.checked)} />
              <span className="dc-switch-track" />
            </label>
          </li>
          <li>
            <Field icon="ranking" label="排名人数（名）" hint="每个学部显示前几名，1 到 100" error={outside(rankingSize, RANKING) ? allowed(RANKING) : undefined}>
              <Stepper label="排名人数" value={rankingSize} onChange={(v) => setRankingSize(v.slice(0, 3))} step={1} range={RANKING} />
            </Field>
          </li>
        </ul>
      </section>
      <SalaryGroup draft={pay} onChange={(role, shift, v) => setPay({ ...pay, [role]: { ...pay[role], [shift]: v } })} />
      <section className="dc-stack">
        <h2 className="heading is-section">学年</h2>
        <div className="dc-card">
          {/* Only the month and day count; the calendar shows them in this year, and 29 February becomes the 28th. */}
          <DatePicker label="升年级日期" value={`${today().slice(0, 4)}-${pad(month)}-${pad(Math.min(day, days))}`}
            shown={`${month}月${Math.min(day, days)}日`} rule="每年从这天起，所有学生的年级加一"
            onChange={(d) => { const [m, dd] = d.slice(5).split('-').map(Number); setMonth(m); setDay(m === 2 ? Math.min(dd, 28) : dd); }} />
          <p className="dc-top-sub" style={{ margin: 'var(--space-2) 0 0' }}>每年从这天起，所有学生的年级加一</p>
        </div>
      </section>
      <RateGroup draft={rates} problems={ratesWrong} onChange={(k, v) => setRates({ ...rates, [k]: v })} />
      <CreditGroup curve={curve} problems={curveWrong} onCurve={(k, v) => setCurve({ ...curve, [k]: v })}
        rules={rules} onRule={(k, v) => setRules({ ...rules, [k]: v })} />
      <div className="dc-actions">
        <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="submit" disabled={busy || invalid || !(changed.length || ratesChanged)}>
          {busy ? '正在保存' : '保存参数'}
        </button>
      </div>
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </form>
  );
}
