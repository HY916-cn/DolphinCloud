-- 货币登记与监控、经营看板 (PHASE-2.md §11, §15, §16.2): record_currency, currency_overview and dashboard; bank_report
-- adds 放款、还款、利息、定期, the business count, what is held at the period's end and the bank's cash, so each number
-- of the dashboard is a number of the report.

-- Signed counts of a 更正: configured denominations, −100000–100000 each, not all 0, the HTB within ±10000000.
create function app_private.signed_cash_total(p_cash jsonb) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  v_total bigint := 0;
  v_key text;
  v_count jsonb;
begin
  if jsonb_typeof(p_cash) is distinct from 'object' or not exists (select 1 from jsonb_each(p_cash) e where e.value <> '0') then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  for v_key, v_count in select key, value from jsonb_each(p_cash) loop
    if v_key !~ '^[0-9]{1,6}$' or not app_private.json_int_between(v_count, -100000, 100000)
       or not app_private.setting('denominations') @> jsonb_build_array(v_key::integer) then
      perform app_private.fail('INVALID_AMOUNT');
    end if;
    v_total := v_total + v_key::bigint * v_count::bigint;
  end loop;
  if abs(v_total) > 10000000 then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  return v_total;
end
$$;

-- A record with the name of who entered it.
create function app_private.currency_move_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(m) || jsonb_build_object('created_by_name', p.display_name)
  from public.currency_moves m join public.profiles p on p.id = m.created_by where m.id = p_id
$$;

-- §11.1. p_id is the record's id (幂等键). baseline: p_on_date, p_denominations, once; issue: p_batch_no, p_on_date,
-- p_denominations, p_reason (用途), p_approver_name; recover, destroy: p_on_date, p_denominations, p_reason; correction:
-- p_corrects (a record that is not a 更正), signed p_denominations, p_reason, dated today, and the record's counts with all
-- its 更正 stay 0 or more for every denomination.
create function public.record_currency(p_id uuid, p_kind text, p_denominations jsonb, p_on_date date default null,
  p_reason text default null, p_batch_no text default null, p_approver_name text default null, p_corrects uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_today date := app_private.cn_date(now());
  v_reason text := nullif(trim(p_reason), '');
  v_batch text := nullif(trim(p_batch_no), '');
  v_approver text := nullif(trim(p_approver_name), '');
  v_target public.currency_moves;
  v_total integer;
  v_note text;
begin
  perform app_private.forbid_president();
  if p_id is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"id"}');
  end if;
  if exists (select 1 from public.currency_moves where id = p_id) then
    return app_private.currency_move_json(p_id);
  end if;
  if p_kind is null or p_kind not in ('baseline', 'issue', 'recover', 'destroy', 'correction') then
    perform app_private.fail('INVALID_INPUT', '{"field":"kind"}');
  end if;
  if p_kind = 'correction' then
    v_total := app_private.signed_cash_total(p_denominations);
    select * into v_target from public.currency_moves where id = p_corrects for update;
    if v_target.id is null or v_target.kind = 'correction' then
      perform app_private.fail('INVALID_INPUT', '{"field":"corrects"}');
    end if;
    select n.key into v_note
    from jsonb_each_text(p_denominations) n
    where coalesce((v_target.denominations ->> n.key)::integer, 0) + n.value::integer
      + coalesce((select sum((c.denominations ->> n.key)::integer) from public.currency_moves c where c.corrects = v_target.id), 0) < 0
    order by n.key::integer limit 1;
    if v_note is not null then
      perform app_private.fail('INVALID_AMOUNT', jsonb_build_object('denomination', v_note::integer));
    end if;
  else
    v_total := app_private.cash_total(p_denominations);
    if v_total <= 0 then
      perform app_private.fail('INVALID_AMOUNT');
    end if;
    if p_on_date is null or p_on_date > v_today then
      perform app_private.fail('INVALID_INPUT', '{"field":"on_date"}');
    end if;
  end if;
  if p_kind <> 'baseline' and v_reason is null or length(v_reason) > 100 then
    perform app_private.fail('INVALID_INPUT', '{"field":"reason"}');
  end if;
  if p_kind = 'issue' then
    if v_batch is null or length(v_batch) > 40 then
      perform app_private.fail('INVALID_INPUT', '{"field":"batch_no"}');
    end if;
    if v_approver is null or length(v_approver) > 40 then
      perform app_private.fail('INVALID_INPUT', '{"field":"approver_name"}');
    end if;
    if exists (select 1 from public.currency_moves where kind = 'issue' and batch_no = v_batch) then
      perform app_private.fail('ALREADY_EXISTS', '{"field":"batch_no"}');
    end if;
  end if;
  if p_kind = 'baseline' and exists (select 1 from public.currency_moves where kind = 'baseline') then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"kind"}');
  end if;
  insert into public.currency_moves (id, kind, batch_no, on_date, denominations, total, reason, approver_name, corrects, created_by)
  values (p_id, p_kind, case when p_kind = 'issue' then v_batch end, case when p_kind = 'correction' then v_today else p_on_date end,
    p_denominations, v_total, v_reason, case when p_kind = 'issue' then v_approver end,
    case when p_kind = 'correction' then p_corrects end, v_me);
  return app_private.currency_move_json(p_id);
end
$$;

-- 货币监控 (§11.2) by the end of p_to, by denomination ("notes", counts) and in HTB ("paper"): the records with their 更正
-- (dated up to p_to) and "flow", the notes every transaction from the 期初现金 on brought in less those it paid out
-- (all transactions without one). bank = baseline + issued − recovered − destroyed + flow; students = −flow, the notes
-- that went to students since (below 0 when students brought in notes they held before). Electronic money "new" since
-- the 期初现金: 工资, 利息 (活期结息 and 定期 interest), 理财盈亏, 放款 into the account and 还款 from it, transactions not
-- reversed only.
-- jit off: the jsonb function scans make the planner's estimate high enough to JIT-compile, ~0.5 s for a few rows.
create function app_private.currency_state(p_to date) returns jsonb
language sql stable security definer set search_path = '' set jit = off as $$
  with base as (
    select created_at as since from public.currency_moves where kind = 'baseline'
  ), win as (
    select t.* from public.txns t
    where t.created_at >= coalesce((select since from base), '-infinity')
      and t.created_at < (p_to + 1)::timestamp at time zone 'Asia/Shanghai'
  ), moves as (
    select coalesce(o.kind, m.kind) as kind, n.key::integer as note, n.value::integer as n
    from public.currency_moves m left join public.currency_moves o on o.id = m.corrects
    cross join jsonb_each_text(m.denominations) n
    where m.on_date <= p_to
  ), flows as (
    select e.key::integer as note, sum(case k.side when 'income' then e.value::integer else -e.value::integer end) as n
    from win t cross join lateral (select app_private.txn_cash(t) as c) x
    cross join (values ('income'), ('payout')) k(side) cross join jsonb_each_text(x.c -> k.side) e
    group by 1
  ), notes as (
    select d::integer as note from jsonb_array_elements_text(app_private.setting('denominations')) d
    union select note from moves union select note from flows
  ), rows as (
    select n.note,
      coalesce((select sum(m.n) from moves m where m.note = n.note and m.kind = 'baseline'), 0)::integer as baseline,
      coalesce((select sum(m.n) from moves m where m.note = n.note and m.kind = 'issue'), 0)::integer as issued,
      coalesce((select sum(m.n) from moves m where m.note = n.note and m.kind = 'recover'), 0)::integer as recovered,
      coalesce((select sum(m.n) from moves m where m.note = n.note and m.kind = 'destroy'), 0)::integer as destroyed,
      coalesce((select f.n from flows f where f.note = n.note), 0)::integer as flow
    from notes n
  ), full_rows as (
    select r.*, r.baseline + r.issued - r.recovered - r.destroyed + r.flow as bank, -r.flow as students from rows r
  ), normal as (
    select * from win where status = 'normal'
  )
  select jsonb_build_object(
    'baseline', (select jsonb_build_object('id', id, 'on_date', on_date, 'created_at', created_at)
                 from public.currency_moves where kind = 'baseline'),
    'notes', (select jsonb_agg(to_jsonb(f) order by f.note) from full_rows f),
    'paper', (select jsonb_build_object('baseline', sum(note * baseline), 'issued', sum(note * issued),
        'recovered', sum(note * recovered), 'destroyed', sum(note * destroyed), 'flow', sum(note * flow),
        'bank', sum(note * bank), 'students', sum(note * students)) from full_rows),
    'new', (select jsonb_build_object(
        'salary', coalesce(sum(t.amount) filter (where t.type = 'salary'), 0),
        'interest', coalesce(sum(t.amount) filter (where t.type = 'interest'), 0)
          + coalesce(sum(t.amount - d.principal) filter (where t.type = 'term_close'), 0),
        'wealth', coalesce(sum(t.amount - w.principal) filter (where t.type = 'wealth_close'), 0),
        'loan', coalesce(sum(t.amount) filter (where t.type = 'loan' and t.payment = 'account'), 0),
        'repay', coalesce(sum(t.amount) filter (where t.type = 'repay' and t.payment = 'account'), 0))
      from normal t left join public.term_deposits d on d.id = t.term_id and t.type = 'term_close'
      left join public.wealth_holdings w on w.id = t.wealth_id and t.type = 'wealth_close'))
$$;

-- The notes in the cash boxes: each teller's latest count (the accountant's when they entered one, else the teller's),
-- summed by denomination, with how many boxes and the time of the latest of them.
create function app_private.latest_counts() returns jsonb
language sql stable security definer set search_path = '' as $$
  with latest as (
    select distinct on (d.user_id) coalesce(c.review_count, c.teller_count) as cnt, d.ended_at
    from public.duty d join public.cash_counts c on c.duty_id = d.id
    where coalesce(c.review_count, c.teller_count) is not null
    order by d.user_id, d.started_at desc
  )
  select jsonb_build_object('boxes', count(*), 'at', max(ended_at),
    'notes', (select coalesce(jsonb_object_agg(note, n), '{}') from (
      select e.key as note, sum(e.value::integer) as n from latest l cross join jsonb_each_text(l.cnt) e group by e.key) x))
  from latest
$$;

-- 账户余额合计 (活期 + 定期 + 理财本金) and 兑付能力 = 银行应有现金 ÷ 账户余额合计, in percent to 0.1 (null without
-- balances); low below payout_ratio_min.
create function app_private.payout(p_bank integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('current', b.current, 'term', b.term, 'wealth', b.wealth, 'total', b.total,
    'ratio', case when b.total > 0 then round(100.0 * p_bank / b.total, 1) end,
    'min', app_private.setting('payout_ratio_min'),
    'low', b.total > 0 and 100.0 * p_bank / b.total < (app_private.setting('payout_ratio_min'))::numeric)
  from (select coalesce(sum(balance), 0)::integer as current, coalesce(sum(term_total), 0)::integer as term,
      coalesce(sum(wealth_total), 0)::integer as wealth, coalesce(sum(balance + term_total + wealth_total), 0)::integer as total
    from public.accounts) b
$$;

-- 「货币」页 (§11.2, §16.2): currency_state today; each denomination's notes also with the cash boxes' latest counts
-- ("counted", null for a denomination no count has); electronic money now and its "new"; 兑付能力.
create function public.currency_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('accountant', 'teacher');
  v_state jsonb := app_private.currency_state(app_private.cn_date(now()));
  v_counts jsonb := app_private.latest_counts();
  v_balance jsonb := app_private.payout((v_state #>> '{paper,bank}')::integer);
  v_new jsonb := v_state -> 'new';
begin
  return jsonb_build_object(
    'baseline', v_state -> 'baseline',
    'notes', (select jsonb_agg(n || jsonb_build_object('counted', (v_counts -> 'notes' ->> (n ->> 'note'))::integer)
      order by (n ->> 'note')::integer) from jsonb_array_elements(v_state -> 'notes') n),
    'paper', v_state -> 'paper',
    'counted', jsonb_build_object('boxes', v_counts -> 'boxes', 'at', v_counts -> 'at',
      'total', (select coalesce(sum(key::integer * value::integer), 0) from jsonb_each_text(v_counts -> 'notes'))),
    'electronic', jsonb_build_object('current', v_balance -> 'current', 'term', v_balance -> 'term',
      'wealth', v_balance -> 'wealth', 'total', v_balance -> 'total',
      'new', v_new || jsonb_build_object('total', (v_new ->> 'salary')::integer + (v_new ->> 'interest')::integer
        + (v_new ->> 'wealth')::integer + (v_new ->> 'loan')::integer - (v_new ->> 'repay')::integer)),
    'payout', jsonb_build_object('ratio', v_balance -> 'ratio', 'min', v_balance -> 'min', 'low', v_balance -> 'low'));
end
$$;

-- 业务: what the counter and the bank admin's 补录 do for students, not reversed: 存款、取款、兑换、放款、还款、开定期、
-- 定期转回、买理财、理财转回; the system's 结息, 到期 and 自动扣款, 工资, 开户, 注销, 调账 and 冲正 are not.
create function app_private.is_business(p_txn public.txns) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_txn.status = 'normal' and p_txn.operator_id <> app_private.system_user()
    and p_txn.type in ('deposit', 'withdraw', 'purchase', 'loan', 'repay', 'term_open', 'term_close', 'wealth_buy', 'wealth_close')
$$;

-- 经营看板 (§16.2): 账户余额 (活期 + 定期 + 理财本金, as 货币监控), 银行应有现金 and 兑付能力, 贷款余额 with the overdue
-- ones, 文创库存 (pieces, and cost where the product has one), 本周业务笔数, 本周锚点, and the business of the last 12 weeks
-- (Monday to Sunday, oldest first, this week last). Each equals bank_report over the same days.
create function public.dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('accountant', 'teacher');
  v_today date := app_private.cn_date(now());
  v_monday date := date_trunc('week', v_today)::date;
  v_bank integer := (app_private.currency_state(v_today) #>> '{paper,bank}')::integer;
  v_balance jsonb := app_private.payout(v_bank);
  v_weeks jsonb;
begin
  select jsonb_agg(jsonb_build_object('week_start', w.week_start, 'count', coalesce(c.n, 0)) order by w.week_start)
  into v_weeks
  from (select (v_monday - 7 * i) as week_start from generate_series(0, 11) i) w
  left join (select date_trunc('week', app_private.cn_date(t.created_at))::date as week_start, count(*) as n
             from public.txns t
             where t.created_at >= (v_monday - 77)::timestamp at time zone 'Asia/Shanghai' and app_private.is_business(t)
             group by 1) c using (week_start);
  return jsonb_build_object(
    'balance', jsonb_build_object('current', v_balance -> 'current', 'term', v_balance -> 'term',
      'wealth', v_balance -> 'wealth', 'total', v_balance -> 'total'),
    'bank_cash', v_bank,
    'payout', jsonb_build_object('ratio', v_balance -> 'ratio', 'min', v_balance -> 'min', 'low', v_balance -> 'low'),
    'loans', (select jsonb_build_object('count', count(*), 'remaining', coalesce(sum(remaining), 0),
        'overdue', jsonb_build_object('count', count(*) filter (where status = 'overdue'),
          'remaining', coalesce(sum(remaining) filter (where status = 'overdue'), 0)))
      from public.loans where status in ('active', 'overdue')),
    'stock', (select jsonb_build_object('qty', coalesce(sum(stock), 0), 'cost', coalesce(sum(stock * cost), 0),
        'uncosted', count(*) filter (where cost is null and stock > 0)) from public.products),
    'week', v_weeks -> 11,
    'anchor', jsonb_build_object('week_start', (select max(week_start) from public.rate_weeks where week_start <= v_today),
      'anchor', app_private.anchor_on(v_today)),
    'weeks', v_weeks);
end
$$;

revoke execute on function public.record_currency(uuid, text, jsonb, date, text, text, text, uuid), public.currency_overview(),
  public.dashboard() from public, anon;
grant execute on function public.record_currency(uuid, text, jsonb, date, text, text, text, uuid), public.currency_overview(),
  public.dashboard() to authenticated;

-- bank_report as in 20261127000100_manual_entry_functions.sql, with 放款 (loans), 还款 with its principal and interest
-- (repays), 活期结息 (interest), 开定期 and 定期转回 with the interest paid (terms), not reversed; the 业务 count of
-- dashboard (operations); 定期本金、理财本金 and 贷款剩余本金 at the end of the period (holdings, each transaction and its
-- reversal counted at its own time); 发行 from currency_moves with their 更正, and 银行应有现金 at the end (bank_cash,
-- currency_state).
create or replace function public.bank_report(p_from date, p_to date, p_division text default null, p_cohort integer default null,
  p_class_no integer default null, p_student_no text default null, p_time_from time default null, p_time_to time default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('accountant', 'teacher');
  v_start timestamptz := p_from::timestamp at time zone 'Asia/Shanghai';
  v_end timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Shanghai';
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    perform app_private.fail('INVALID_INPUT', '{"field":"period"}');
  end if;
  if p_time_from >= p_time_to then
    perform app_private.fail('INVALID_INPUT', '{"field":"time"}');
  end if;
  return (
    with scope as (
      select s.student_no, s.division, s.cohort, s.class_no, s.status, public.class_label(s) as class_label
      from public.students s
      -- Students opened by the end of the period; one with a transaction before then counts whatever opened_at says.
      where (s.opened_at < v_end or exists (select 1 from public.txns x where x.student_no = s.student_no and x.created_at < v_end))
        and (p_division is null or s.division = p_division) and (p_cohort is null or s.cohort = p_cohort)
        and (p_class_no is null or s.class_no = p_class_no) and (p_student_no is null or s.student_no = p_student_no)
    ),
    whole_days as (
      select x.* from public.txns x join scope using (student_no) where x.created_at >= v_start and x.created_at < v_end
    ),
    t as (
      select * from whole_days x
      where (p_time_from is null or public.cn_time(x) >= p_time_from) and (p_time_to is null or public.cn_time(x) < p_time_to)
    ),
    live as (select * from t where status = 'normal' and type in ('deposit', 'withdraw', 'purchase')),
    opening as (
      select x.student_no, sum(x.balance_delta) as balance
      from public.txns x join scope using (student_no) where x.created_at < v_start group by x.student_no
    ),
    closing as (
      select x.student_no, sum(x.balance_delta) as balance
      from public.txns x join scope using (student_no) where x.created_at < v_end group by x.student_no
    ),
    per_student as (
      select student_no, count(*) as n,
        coalesce(sum(amount) filter (where type = 'deposit'), 0) as deposit,
        coalesce(sum(amount) filter (where type = 'withdraw'), 0) as withdraw,
        coalesce(sum(amount) filter (where type = 'purchase' and payment = 'account'), 0) as spent
      from live group by student_no
    ),
    holders as (
      select s.*, coalesce(c.balance, 0) as balance, coalesce(p.n, 0) as n, coalesce(p.deposit, 0) as deposit,
        coalesce(p.withdraw, 0) as withdraw, coalesce(p.spent, 0) as spent
      from scope s left join closing c using (student_no) left join per_student p using (student_no)
    )
    select jsonb_build_object(
      'business', (select jsonb_build_object(
        'deposit', jsonb_build_object('count', count(*) filter (where type = 'deposit'),
          'amount', coalesce(sum(amount) filter (where type = 'deposit'), 0)),
        'withdraw', jsonb_build_object('count', count(*) filter (where type = 'withdraw'),
          'amount', coalesce(sum(amount) filter (where type = 'withdraw'), 0)),
        'purchase_account', jsonb_build_object('count', count(*) filter (where type = 'purchase' and payment = 'account'),
          'amount', coalesce(sum(amount) filter (where type = 'purchase' and payment = 'account'), 0)),
        'purchase_cash', jsonb_build_object('count', count(*) filter (where type = 'purchase' and payment = 'cash'),
          'amount', coalesce(sum(amount) filter (where type = 'purchase' and payment = 'cash'), 0)),
        'students', count(distinct student_no)) from live),
      'loans', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from t
        where type = 'loan' and status = 'normal'),
      'repays', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(x.amount), 0),
          'principal', coalesce(sum(p.principal), 0), 'interest', coalesce(sum(p.interest), 0))
        from t x join public.loan_payments p on p.txn_id = x.id where x.type = 'repay' and x.status = 'normal'),
      'interest', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from t
        where type = 'interest' and status = 'normal'),
      'terms', (select jsonb_build_object(
          'open', jsonb_build_object('count', count(*) filter (where x.type = 'term_open'),
            'amount', coalesce(sum(x.amount) filter (where x.type = 'term_open'), 0)),
          'close', jsonb_build_object('count', count(*) filter (where x.type = 'term_close'),
            'amount', coalesce(sum(x.amount) filter (where x.type = 'term_close'), 0),
            'interest', coalesce(sum(x.amount - d.principal) filter (where x.type = 'term_close'), 0)))
        from t x join public.term_deposits d on d.id = x.term_id
        where x.type in ('term_open', 'term_close') and x.status = 'normal'),
      'operations', (select jsonb_build_object('count', count(*)) from t where app_private.is_business(t)),
      'holdings', (select jsonb_build_object(
          'term', coalesce(sum(d.principal * case when o.type = 'term_open' then 1 else -1 end * x.sign)
            filter (where o.type in ('term_open', 'term_close')), 0),
          'wealth', coalesce(sum(w.principal * case when o.type = 'wealth_buy' then 1 else -1 end * x.sign)
            filter (where o.type in ('wealth_buy', 'wealth_close')), 0),
          'loans', coalesce(sum(case when o.type = 'loan' then o.amount else -p.principal end * x.sign)
            filter (where o.type in ('loan', 'repay')), 0))
        from (select x.*, case when x.type = 'reversal' then -1 else 1 end as sign
              from public.txns x join scope using (student_no) where x.created_at < v_end
                and (x.term_id is not null or x.wealth_id is not null or x.loan_id is not null or x.type = 'reversal')) x
        join public.txns o on o.id = coalesce(x.reversal_of, x.id)
        left join public.term_deposits d on d.id = o.term_id
        left join public.wealth_holdings w on w.id = o.wealth_id
        left join public.loan_payments p on p.txn_id = o.id),
      'adjust', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(balance_delta), 0)) from t
        where type = 'adjust' and status = 'normal'),
      'reversals', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from t where type = 'reversal'),
      'reversed', (select count(*) from t where status = 'reversed'),
      'openings', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from t where type = 'opening'),
      'balance', jsonb_build_object(
        'opening', (select coalesce(sum(balance), 0) from opening),
        'closing', (select coalesce(sum(balance), 0) from closing),
        'changes', (select coalesce(jsonb_object_agg(type, delta), '{}') from (
          select type, sum(balance_delta) as delta from whole_days group by type) d)),
      'cash', (select jsonb_build_object('in', coalesce(sum(cash_delta) filter (where cash_delta > 0), 0),
        'out', coalesce(-sum(cash_delta) filter (where cash_delta < 0), 0)) from t),
      'days', (select jsonb_agg(jsonb_build_object('day', g.day,
          'deposit', coalesce(d.deposit, 0), 'deposit_count', coalesce(d.deposit_count, 0),
          'withdraw', coalesce(d.withdraw, 0), 'withdraw_count', coalesce(d.withdraw_count, 0),
          'purchase', coalesce(d.purchase, 0), 'purchase_count', coalesce(d.purchase_count, 0),
          'students', coalesce(d.students, 0), 'change', coalesce(e.change, 0)) order by g.day)
        from (select generate_series(p_from, p_to, interval '1 day')::date as day) g
        left join (select app_private.cn_date(created_at) as day, sum(balance_delta) as change from whole_days group by 1) e using (day)
        left join (select app_private.cn_date(created_at) as day,
            coalesce(sum(amount) filter (where type = 'deposit'), 0) as deposit, count(*) filter (where type = 'deposit') as deposit_count,
            coalesce(sum(amount) filter (where type = 'withdraw'), 0) as withdraw, count(*) filter (where type = 'withdraw') as withdraw_count,
            coalesce(sum(amount) filter (where type = 'purchase'), 0) as purchase, count(*) filter (where type = 'purchase') as purchase_count,
            count(distinct student_no) as students
          from live group by 1) d using (day)),
      'hours', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'count', n) order by h), '[]') from (
        select extract(hour from created_at at time zone 'Asia/Shanghai')::integer as h, count(*) as n from live group by 1) x),
      'tellers', (select coalesce(jsonb_agg(jsonb_build_object('name', p.display_name, 'count', x.n,
          'deposit_count', x.deposit_count, 'deposit', x.deposit, 'withdraw_count', x.withdraw_count, 'withdraw', x.withdraw,
          'purchase_count', x.purchase_count, 'purchase', x.purchase, 'reversed', x.reversed, 'reversals', x.reversals)
          order by x.n desc, p.display_name), '[]')
        from (select operator_id,
            count(*) filter (where status = 'normal' and type in ('deposit', 'withdraw', 'purchase')) as n,
            count(*) filter (where status = 'normal' and type = 'deposit') as deposit_count,
            coalesce(sum(amount) filter (where status = 'normal' and type = 'deposit'), 0) as deposit,
            count(*) filter (where status = 'normal' and type = 'withdraw') as withdraw_count,
            coalesce(sum(amount) filter (where status = 'normal' and type = 'withdraw'), 0) as withdraw,
            count(*) filter (where status = 'normal' and type = 'purchase') as purchase_count,
            coalesce(sum(amount) filter (where status = 'normal' and type = 'purchase'), 0) as purchase,
            count(*) filter (where status = 'reversed' and type <> 'opening') as reversed,
            count(*) filter (where type = 'reversal') as reversals
          from t where type <> 'opening' and operator_id <> app_private.system_user() group by operator_id) x
        join public.profiles p on p.id = x.operator_id),
      'classes', (select coalesce(jsonb_agg(to_jsonb(c) order by c.division desc, c.cohort desc, c.class_no), '[]') from (
        select division, cohort, class_no, class_label, count(*) as students, count(*) filter (where n > 0) as active,
          sum(balance) as balance, sum(deposit) as deposit, sum(withdraw) as withdraw, sum(spent) as spent
        from holders group by division, cohort, class_no, class_label) c),
      'students', (select jsonb_build_object('total', count(*), 'active', count(*) filter (where n > 0),
          'normal', count(*) filter (where status = 'normal'), 'frozen', count(*) filter (where status = 'frozen'),
          'graduated', count(*) filter (where status = 'graduated'),
          'closed', count(*) filter (where status = 'closed'), 'balance', coalesce(sum(balance), 0),
          'median', coalesce(percentile_disc(0.5) within group (order by balance), 0), 'max', coalesce(max(balance), 0))
        from holders),
      'distribution', (select jsonb_agg(jsonb_build_object('label', b.label, 'count', (
          select count(*) from holders a where a.balance >= b.lo and (b.hi is null or a.balance <= b.hi))) order by b.lo)
        from (values ('0', 0, 0), ('1–19', 1, 19), ('20–49', 20, 49), ('50–99', 50, 99), ('100–199', 100, 199),
          ('200 以上', 200, null)) b(label, lo, hi)),
      'products', (select coalesce(jsonb_agg(to_jsonb(x) order by x.qty desc, x.name), '[]') from (
        select p.name, sum(i.qty) as qty, sum(i.qty * i.unit_price) as amount,
          coalesce(sum(i.qty * i.unit_price) filter (where l.payment = 'account'), 0) as account,
          coalesce(sum(i.qty * i.unit_price) filter (where l.payment = 'cash'), 0) as cash,
          case when bool_and(p.cost is not null) then sum(i.qty * p.cost) end as cost
        from live l join public.txn_items i on i.txn_id = l.id join public.products p on p.id = i.product_id
        where l.type = 'purchase' group by p.id, p.name) x),
      'stock', (select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]') from (
        select p.name, p.price, p.cost,
          p.stock - coalesce(sum(m.qty_delta) filter (where m.created_at >= v_start), 0) as opening,
          coalesce(sum(m.qty_delta) filter (where m.kind = 'stock_in' and m.created_at >= v_start and m.created_at < v_end), 0) as stock_in,
          coalesce(-sum(m.qty_delta) filter (where m.kind = 'stock_out' and m.created_at >= v_start and m.created_at < v_end), 0) as stock_out,
          coalesce(-sum(m.qty_delta) filter (where m.kind in ('sale', 'reversal') and m.created_at >= v_start and m.created_at < v_end), 0) as sold,
          p.stock - coalesce(sum(m.qty_delta) filter (where m.created_at >= v_end), 0) as closing
        from public.products p left join public.stock_movements m on m.product_id = p.id group by p.id) x),
      'issues', jsonb_build_object(
        'batches', (select coalesce(jsonb_agg(jsonb_build_object('batch_no', m.batch_no, 'issued_on', m.on_date,
            'total', m.total + coalesce(c.total, 0), 'purpose', m.reason, 'approver', m.approver_name,
            'denominations', m.denominations, 'corrections', coalesce(c.denominations, '[]')) order by m.on_date, m.batch_no), '[]')
          from public.currency_moves m
          left join lateral (select sum(total) as total, jsonb_agg(denominations order by created_at, id) as denominations
            from public.currency_moves where corrects = m.id and on_date <= p_to) c on true
          where m.kind = 'issue' and m.on_date between p_from and p_to),
        'total', (app_private.currency_state(p_to) #>> '{paper,issued}')::integer),
      'bank_cash', (app_private.currency_state(p_to) #>> '{paper,bank}')::integer));
end
$$;
