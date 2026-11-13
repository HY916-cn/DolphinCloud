-- 定期定值 (PHASE-2.md §9.2, §9.5, §10.2, §14.3): 定期 runs 2, 4, 12, 24 or 48 weeks at the fixed weekly rate the bank
-- admin or the president sets for each length in term_rates, whatever the anchor and the score. It may run past the
-- term's end and through the holidays, paying 本金 × 周利率 × 周数 at maturity; a 定期 already open keeps the rate it
-- locked. run_daily matures 定期 on every day, holidays too, and an open 定期 no longer keeps a term from 结转.

-- term_rates: weekly percentages by length, above the usual 活期 rate (2.08% at the initial anchor and 600 分, 2.4% at
-- 1000 分) and below the lowest loan rate (4.4% at 1000 分), higher the longer the money is locked away.
insert into public.settings (key, value) values ('term_rates', '{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5}');
delete from public.settings where key = 'term_multipliers';

-- 8 weeks stays valid for the 定期 opened before; new ones take the lengths of term_rates.
alter table public.term_deposits drop constraint term_deposits_weeks_check;
alter table public.term_deposits add constraint term_deposits_weeks_check check (weeks in (2, 4, 8, 12, 24, 48));

-- The fixed weekly rate of a length (§9.2), null for a length term_rates does not have.
drop function app_private.term_rate(numeric, integer, integer);
create function app_private.term_rate(p_weeks integer) returns numeric
language sql stable security definer set search_path = '' as $$
  select (app_private.setting('term_rates') ->> p_weeks::text)::numeric
$$;

-- rates as in 20261115000100_interest.sql: term is term_rates, the same for every anchor and score.
create or replace function app_private.rates(p_anchor numeric, p_score integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('current', app_private.saving_rate(p_anchor, p_score),
    'term', app_private.setting('term_rates'),
    'loan', app_private.loan_rate(p_anchor, p_score))
$$;

-- start_term_deposit as in 20261118000000_term_reason.sql, at the fixed rate of its length.
create or replace function app_private.start_term_deposit(p_id uuid, p_student_no text, p_amount integer, p_weeks integer,
  p_operator uuid, p_at timestamptz) returns public.term_deposits
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := app_private.cn_date(p_at);
  v_txn uuid := gen_random_uuid();
  v_account public.accounts;
  v_dep public.term_deposits;
begin
  update public.accounts set balance = balance - p_amount, term_total = term_total + p_amount, updated_at = now()
  where student_no = p_student_no returning * into v_account;
  insert into public.term_deposits (id, student_no, principal, weeks, rate, opened_on, matures_on, open_txn)
  values (p_id, p_student_no, p_amount, p_weeks, app_private.term_rate(p_weeks), v_day, v_day + 7 * p_weeks, v_txn)
  returning * into v_dep;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, device_id, term_id, created_at)
  values (v_txn, 'term_open', p_student_no, p_amount, -p_amount, v_account.balance,
    p_weeks || ' 周，' || to_char(v_dep.matures_on, 'FMMM月FMDD日') || ' 到期', p_operator,
    app_private.request_header('x-device-id'), p_id, p_at);
  return v_dep;
end
$$;

-- open_term_deposit as in 20261119000100_loans.sql: any of the lengths of term_rates, in term or in the holidays,
-- whenever it ends.
create or replace function public.open_term_deposit(p_id uuid, p_student_no text, p_amount integer, p_weeks integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_account public.accounts;
  v_dep public.term_deposits;
begin
  perform app_private.forbid_president();
  v_account := app_private.lock_account(p_student_no, v_me);
  select * into v_dep from public.term_deposits where id = p_id;
  if found then
    return app_private.term_result(v_dep, v_dep.open_txn);
  end if;
  if app_private.term_rate(p_weeks) is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"weeks"}');
  end if;
  if p_amount is null or p_amount <= 0 then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  if p_amount > v_account.balance then
    perform app_private.fail('INSUFFICIENT_BALANCE', jsonb_build_object('balance', v_account.balance, 'short', p_amount - v_account.balance));
  end if;
  if exists (select 1 from public.loans where student_no = p_student_no and status in ('active', 'overdue')) then
    perform app_private.fail('LOAN_OUTSTANDING');
  end if;
  v_dep := app_private.start_term_deposit(p_id, p_student_no, p_amount, p_weeks, v_me, now());
  return app_private.term_result(v_dep, v_dep.open_txn);
end
$$;

-- term_quote as in 20261116000100_term_deposits.sql: every length of term_rates with its fixed rate and maturity date;
-- term is the current term or null in the holidays, which no longer keep a 定期 from opening.
create or replace function public.term_quote(p_student_no text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_today date := app_private.cn_date(now());
  v_term public.terms := app_private.current_term(v_today);
  v_student public.students;
begin
  select * into v_student from public.students where student_no = p_student_no;
  if not found then
    perform app_private.fail('STUDENT_NOT_FOUND');
  end if;
  if v_student.status = 'closed' then
    perform app_private.fail('STUDENT_INACTIVE', '{"status":"closed"}');
  end if;
  if v_student.user_id = v_me or exists (select 1 from public.staff_payroll where user_id = v_me and account = p_student_no) then
    perform app_private.fail('SELF_SERVICE_FORBIDDEN');
  end if;
  return (select jsonb_build_object('student_no', p_student_no, 'score', (select score from public.credit_scores where student_no = p_student_no),
      'term', case when v_term.id is not null then jsonb_build_object('id', v_term.id, 'name', v_term.name, 'ends_on', v_term.ends_on) end,
      'options', (select jsonb_agg(jsonb_build_object('weeks', k::integer, 'rate', r::numeric, 'matures_on', v_today + 7 * k::integer)
          order by k::integer) from jsonb_each_text(app_private.setting('term_rates')) x(k, r)),
      'balance', a.balance, 'term_total', a.term_total,
      'deposits', coalesce((select jsonb_agg(to_jsonb(d) order by d.opened_on desc, d.id) from public.term_deposits d
        where d.student_no = p_student_no), '[]'))
    from public.accounts a where a.student_no = p_student_no);
end
$$;

-- 到期 (§10.2) at the end of p_day, in term or in the holidays, dated the next midnight, by the system login: the agreed
-- interest. As in 20261116000100_term_deposits.sql, without maturing everything on a term's last day.
drop function app_private.mature_term_deposits(date, boolean);
create function app_private.mature_term_deposits(p_day date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := 0;
  r record;
begin
  for r in
    select id, expected_centi from public.term_deposits where status = 'open' and matures_on <= p_day order by student_no, id
  loop
    v_n := v_n + (app_private.end_term_deposit(r.id, 'matured', r.expected_centi, app_private.system_user(),
      (p_day + 1)::timestamp at time zone 'Asia/Shanghai') is not null)::integer;
  end loop;
  -- M14 货币监控：定期利息计为电子币新增（§9.6）
  return v_n;
end
$$;

-- run_daily as in 20261119000100_loans.sql, the 定期 maturing on every day, in the holidays too.
create or replace function app_private.run_daily(p_day date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_done date;
  v_term public.terms := app_private.current_term(p_day);
begin
  select done_to into v_done from public.job_runs where job = 'daily' for update;
  if p_day <= v_done then
    return jsonb_build_object('job', 'daily', 'day', p_day, 'status', 'skipped');
  end if;
  if p_day <> v_done + 1 or p_day >= app_private.cn_date(now()) then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'day', 'next', v_done + 1));
  end if;
  -- In this order (§13); in the holidays only the 定期 that mature.
  if v_term.id is not null then
    perform app_private.accrue_interest(p_day);
  end if;
  perform app_private.mature_term_deposits(p_day);
  if v_term.id is not null then
    perform app_private.collect_loans(p_day, p_day = v_term.ends_on);
    perform app_private.accrue_loans(p_day);
    if p_day = v_term.ends_on then
      perform app_private.settle_interest((p_day + 1)::timestamp at time zone 'Asia/Shanghai');
    end if;
  end if;
  update public.job_runs set done_to = p_day, last_ok = now(), last_err = null where job = 'daily';
  return jsonb_build_object('job', 'daily', 'day', p_day, 'status', case when v_term.id is null then 'holiday' else 'done' end,
    'term_id', v_term.id);
end
$$;

-- What keeps a term from 结转 (§6.3), as in 20261119000100_loans.sql: the daily job and the loans; a 定期 still open
-- carries over to the next term as it is.
create or replace function app_private.term_open_items(p_term public.terms) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(i order by k, day, student_no), '[]') from (
    select 0 as k, null::date as day, null::text as student_no, jsonb_build_object('kind', 'job', 'job', job, 'done_to', done_to) as i
    from public.job_runs where job = 'daily' and done_to < p_term.ends_on
    union all
    select 2, x.due_on, l.student_no, jsonb_build_object('kind', 'loan', 'id', l.id, 'loan_no', l.loan_no, 'student_no', l.student_no,
      'name', s.name, 'remaining', l.remaining, 'status', l.status, 'due_on', x.due_on)
    from public.loans l join public.students s using (student_no),
      lateral (select max(due_on) as due_on from public.loan_periods where loan_id = l.id) x
    where l.status in ('active', 'overdue') and l.opened_on between p_term.starts_on and p_term.ends_on
  ) x
$$;

-- set_setting as in 20261117000000_rate_params.sql, with term_rates (§14.3): the president and the bank admin set the
-- weekly rate of each length; the 定期 already open keep theirs. set_settings checks each value through set_setting.
create or replace function public.set_setting(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_value jsonb := p_value;
begin
  if p_key = 'denominations' then
    if jsonb_typeof(p_value) is distinct from 'array' or jsonb_array_length(p_value) not between 1 and 10
       or not p_value @> '[1]' or exists (select 1 from jsonb_array_elements(p_value) e where not app_private.json_int_between(e, 1, 1000))
       or (select count(distinct e) <> count(*) from jsonb_array_elements(p_value) e) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
    v_value := (select jsonb_agg(e order by e::numeric) from jsonb_array_elements(p_value) e);
  elsif p_key in ('withdraw_single_limit', 'withdraw_daily_limit') then
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k) <> array['junior', 'primary']
       or not app_private.json_int_between(p_value -> 'primary', 1, 1000000)
       or not app_private.json_int_between(p_value -> 'junior', 1, 1000000) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'promotion_date' then
    if jsonb_typeof(p_value) is distinct from 'string' or p_value #>> '{}' !~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
       or to_char(to_date('2000-' || (p_value #>> '{}'), 'YYYY-MM-DD'), 'MM-DD') <> p_value #>> '{}' then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'ranking_size' then
    if not app_private.json_int_between(p_value, 1, 100) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'salary_per_shift' then
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k) <> array['am', 'pm']
       or not app_private.json_int_between(p_value -> 'am', 1, 10000)
       or not app_private.json_int_between(p_value -> 'pm', 1, 10000) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'ranking_anonymous' then
    if jsonb_typeof(p_value) is distinct from 'boolean' then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'credit_curve' then
    -- 最低分 0–999; 额度 1–10000 HTB with limit_step ≤ limit_min ≤ limit_max, so a student who may borrow may borrow a
    -- step at least; 系数 0.1–10 with up to 4 decimals, loan_min ≤ loan_max and saving_min ≤ saving_max.
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k)
          <> array['limit_max', 'limit_min', 'limit_step', 'loan_max', 'loan_min', 'min_score', 'saving_max', 'saving_min']
       or not app_private.json_int_between(p_value -> 'min_score', 0, 999)
       or exists (select 1 from unnest(array['limit_min', 'limit_max', 'limit_step']) k where not app_private.json_int_between(p_value -> k, 1, 10000))
       or exists (select 1 from unnest(array['loan_min', 'loan_max', 'saving_min', 'saving_max']) k
                  where not app_private.json_num_between(p_value -> k, 0.1, 10)) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
    if (p_value ->> 'limit_step')::integer > (p_value ->> 'limit_min')::integer
       or (p_value ->> 'limit_min')::integer > (p_value ->> 'limit_max')::integer
       or (p_value ->> 'loan_min')::numeric > (p_value ->> 'loan_max')::numeric
       or (p_value ->> 'saving_min')::numeric > (p_value ->> 'saving_max')::numeric then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'credit_rules' then
    -- every rule, gains 0–100 points and losses −100–0
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k)
          <> (select array_agg(k order by k) from jsonb_object_keys(app_private.credit_rule_signs()) k)
       or exists (select 1 from jsonb_each(app_private.credit_rule_signs()) s(k, sign)
                  where not app_private.json_int_between(p_value -> k, least(0, sign::integer * 100), greatest(0, sign::integer * 100))) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'anchor_params' then
    -- 锚点 (§9.1), percentages: only initial, min and max change, 0.01–100 in whole hundredths with min ≤ initial ≤ max;
    -- the formula's other keys are fixed and must equal the saved ones.
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k)
          <> array['growth_step', 'growth_target', 'initial', 'max', 'max_adjust', 'min', 'ratio_step', 'ratio_target', 'weight']
       or exists (select 1 from unnest(array['initial', 'min', 'max']) k where not app_private.json_num_between(p_value -> k, 0.01, 100))
       or exists (select 1 from jsonb_each(app_private.setting('anchor_params')) c
                  where c.key not in ('initial', 'min', 'max') and p_value -> c.key is distinct from c.value) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
    if exists (select 1 from unnest(array['initial', 'min', 'max']) k where (p_value ->> k)::numeric <> round((p_value ->> k)::numeric, 2))
       or (p_value ->> 'min')::numeric > (p_value ->> 'initial')::numeric
       or (p_value ->> 'initial')::numeric > (p_value ->> 'max')::numeric then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'term_rates' then
    -- 定期周利率 (§9.2): every length, 0.01–100 with up to 4 decimals
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k) <> array['12', '2', '24', '4', '48']
       or exists (select 1 from jsonb_each(p_value) e where not app_private.json_num_between(e.value, 0.01, 100)) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key in ('loan_multiplier', 'penalty_multiplier') then
    -- fixed by the system (§14.3)
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
  else
    perform app_private.fail('INVALID_INPUT', '{"field":"key"}');
  end if;
  update public.settings set value = v_value, updated_by = v_me, updated_at = now() where key = p_key;
  -- M13 风险提醒 setting_change：利率参数（含 term_rates）、credit_curve、credit_rules、风险阈值、取款限额（对象 settings:<key>；「终止」恢复修改前的值）
  return jsonb_build_object('key', p_key, 'value', v_value);
end
$$;
