-- 风险提醒 (PHASE-2.md §12, §14.2, §14.3): the events of §12.1 each record one alert as they happen, for the president
-- and the bank admin to mark 已查看 or 终止. Recording never fails the business it watches: an alert that cannot be
-- written is skipped with a warning. Counter alerts (大额取款, 提前支取, 冲正, 频繁操作) are for transactions a teller
-- makes; the rest follow the loans, credit events, settings, products and 轧账 they name.

create table public.risk_alerts (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  kind       text not null,                   -- 12.1 的代码
  target     text not null,                   -- 对象：txns:<id>、loans:<id>、settings:<key>、salary_rates、credit_events:<id>、products:<id>、duty:<id>
  student_no text references public.students(student_no),
  staff_id   uuid references public.profiles(id), -- 经办人：柜员、修改参数或调整的人
  detail     jsonb not null,
  status     text not null default 'open' check (status in ('open', 'seen', 'terminated')),
  handled_by uuid references public.profiles(id),
  handled_at timestamptz,
  note       text,                            -- 处理说明；终止时为原因
  check ((status = 'open') = (handled_by is null))
);
-- One alert per event; a parameter changes, a switch turns and stock runs low again and again, low stock once while open.
create unique index risk_alerts_once on public.risk_alerts (kind, target)
  where kind not in ('setting_change', 'credit_switch', 'stock_low');
create unique index risk_alerts_stock_open on public.risk_alerts (target) where kind = 'stock_low' and status = 'open';
create index on public.risk_alerts (status, id desc);
create index on public.risk_alerts (student_no, kind, at desc);
create trigger audit after insert or update or delete on public.risk_alerts for each row execute function app_private.audit_row();
alter table public.risk_alerts enable row level security;
grant select on public.risk_alerts to authenticated;
-- The president and the bank admin (§3).
create policy read on public.risk_alerts for select to authenticated using ((select app_private.has_role('teacher')));

-- §14.3. risk_rules: 大额贷款 above loan_amount HTB or below loan_score points; 大额取款 above withdraw_ratio % of the
-- division's 单笔限额; a teller's reversals-th 冲正 of a day on; ops_count transactions for a student within ops_minutes.
insert into public.settings (key, value) values
  ('risk_rules', '{"loan_amount":50,"loan_score":600,"withdraw_ratio":80,"reversals":3,"ops_count":5,"ops_minutes":10}');

-- The kinds, and those 终止 undoes (§12.1); the others are only marked 已查看.
create function app_private.risk_kinds() returns text[] language sql immutable as $$
  select array['loan_large', 'loan_overdue', 'withdraw_large', 'term_early', 'reversal_many', 'ops_frequent', 'setting_change',
    'credit_adjust', 'stock_low', 'cash_unbalanced', 'manual_entry', 'txn_correct', 'credit_switch']
$$;
create function app_private.risk_terminable(p_kind text) returns boolean language sql immutable as $$
  select p_kind in ('loan_large', 'loan_overdue', 'withdraw_large', 'term_early', 'reversal_many', 'ops_frequent', 'setting_change',
    'credit_adjust')
$$;

-- Records an alert once; a failure is a warning, never the caller's error.
create function app_private.risk_alert(p_kind text, p_target text, p_student_no text, p_staff_id uuid, p_detail jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.risk_alerts (kind, target, student_no, staff_id, detail)
  values (p_kind, p_target, p_student_no, p_staff_id, p_detail)
  on conflict do nothing;
exception when others then
  raise warning 'risk alert % on % not recorded: %', p_kind, p_target, sqlerrm;
end
$$;

-- Transactions: 补录 and 更正 (§10.11) each; a teller's 大额取款, 提前支取, 冲正 from the reversals-th of the day, and the
-- ops_count-th transaction for a student within ops_minutes (one alert per student per window). duty_id is the
-- teller's open duty, which 终止 forces off.
create function app_private.risk_txn() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_rules jsonb;
  v_duty uuid;
  v_n integer;
begin
  if new.entered_at is not null then
    if new.type <> 'reversal' and new.corrects is null then
      perform app_private.risk_alert('manual_entry', 'txns:' || new.id, new.student_no, new.operator_id,
        jsonb_build_object('txn_no', new.txn_no, 'type', new.type, 'amount', new.amount, 'occurred_at', new.created_at, 'reason', new.reason));
    elsif new.type <> 'reversal' then
      perform app_private.risk_alert('txn_correct', 'txns:' || new.corrects, new.student_no, new.operator_id,
        jsonb_build_object('txn_no', new.txn_no, 'original_no', (select txn_no from public.txns where id = new.corrects),
          'type', new.type, 'amount', new.amount, 'reason', new.reason));
    end if;
    return null;
  end if;
  if not exists (select 1 from public.user_roles where user_id = new.operator_id and role = 'teller') then
    return null;
  end if;
  v_rules := app_private.setting('risk_rules');
  v_duty := (select id from public.duty where user_id = new.operator_id and ended_at is null);
  if new.type = 'withdraw'
     and new.amount * 100 > (v_rules ->> 'withdraw_ratio')::integer * app_private.division_limit('withdraw_single_limit', new.student_no) then
    perform app_private.risk_alert('withdraw_large', 'txns:' || new.id, new.student_no, new.operator_id,
      jsonb_build_object('txn_no', new.txn_no, 'amount', new.amount,
        'limit', app_private.division_limit('withdraw_single_limit', new.student_no), 'ratio', (v_rules -> 'withdraw_ratio')));
  elsif new.type = 'term_close' then  -- a teller's is always 提前支取; maturity is the system's
    perform app_private.risk_alert('term_early', 'txns:' || new.id, new.student_no, new.operator_id,
      jsonb_build_object('txn_no', new.txn_no, 'amount', new.amount, 'principal', (select principal from public.term_deposits where id = new.term_id)));
  elsif new.type = 'reversal' then
    select count(*) into v_n from public.txns
    where operator_id = new.operator_id and type = 'reversal' and app_private.cn_date(created_at) = app_private.cn_date(new.created_at);
    if v_n >= (v_rules ->> 'reversals')::integer then
      perform app_private.risk_alert('reversal_many', 'txns:' || new.id, new.student_no, new.operator_id,
        jsonb_build_object('txn_no', new.txn_no, 'original_no', (select txn_no from public.txns where id = new.reversal_of),
          'count', v_n, 'duty_id', v_duty));
    end if;
  end if;
  select count(*) into v_n from public.txns t
  where t.student_no = new.student_no and t.entered_at is null
    and t.created_at > new.created_at - make_interval(mins => (v_rules ->> 'ops_minutes')::integer) and t.created_at <= new.created_at
    and exists (select 1 from public.user_roles r where r.user_id = t.operator_id and r.role = 'teller');
  if v_n >= (v_rules ->> 'ops_count')::integer and not exists (
    select 1 from public.risk_alerts where student_no = new.student_no and kind = 'ops_frequent'
      and at > now() - make_interval(mins => (v_rules ->> 'ops_minutes')::integer)) then
    perform app_private.risk_alert('ops_frequent', 'txns:' || new.id, new.student_no, new.operator_id,
      jsonb_build_object('txn_no', new.txn_no, 'count', v_n, 'minutes', (v_rules -> 'ops_minutes'), 'duty_id', v_duty));
  end if;
  return null;
exception when others then
  raise warning 'risk alert for txn % not recorded: %', new.txn_no, sqlerrm;
  return null;
end
$$;
create trigger risk_alert after insert on public.txns for each row execute function app_private.risk_txn();

-- Loans: 大额贷款 at 放款 (by the score it was lent at), 逾期 the first time it falls overdue.
create function app_private.risk_loan() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_rules jsonb := app_private.setting('risk_rules');
begin
  if tg_op = 'INSERT' then
    if new.principal > (v_rules ->> 'loan_amount')::integer or new.score < (v_rules ->> 'loan_score')::integer then
      perform app_private.risk_alert('loan_large', 'loans:' || new.id, new.student_no, new.operator_id,
        jsonb_build_object('loan_no', new.loan_no, 'amount', new.principal, 'score', new.score,
          'loan_amount', v_rules -> 'loan_amount', 'loan_score', v_rules -> 'loan_score'));
    end if;
  elsif new.status = 'overdue' and old.status <> 'overdue' then
    perform app_private.risk_alert('loan_overdue', 'loans:' || new.id, new.student_no, null,
      jsonb_build_object('loan_no', new.loan_no, 'remaining', new.remaining,
        'seq', (select min(seq) from public.loan_periods where loan_id = new.id and overdue_at is not null and paid < principal)));
  end if;
  return null;
exception when others then
  raise warning 'risk alert for loan % not recorded: %', new.loan_no, sqlerrm;
  return null;
end
$$;
create trigger risk_alert after insert or update of status on public.loans for each row execute function app_private.risk_loan();

-- 手动调整信用分 (§8.3): the bank admin's manual events; 终止's own reversing event carries a ref and is not one.
create function app_private.risk_credit() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.risk_alert('credit_adjust', 'credit_events:' || new.id, new.student_no, new.actor_id,
    jsonb_build_object('delta', new.delta, 'score', new.score, 'reason', new.reason));
  return null;
end
$$;
create trigger risk_alert after insert on public.credit_events for each row when (new.rule = 'manual' and new.ref is null)
  execute function app_private.risk_credit();

-- 信用分开关 (§8.5): each turn, from its credit.switch log with the reason and the students changed.
create function app_private.risk_credit_switch() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.risk_alert('credit_switch', 'settings:credit_enabled', null, new.actor_id, new.after);
  return null;
end
$$;
create trigger risk_alert after insert on public.audit_log for each row when (new.action = 'credit.switch')
  execute function app_private.risk_credit_switch();

-- 库存不足: stock falls to the 安全库存 or below (or the 安全库存 is raised to it).
create function app_private.risk_stock() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.risk_alert('stock_low', 'products:' || new.id, null, null,
    jsonb_build_object('name', new.name, 'stock', new.stock, 'safety_stock', new.safety_stock));
  return null;
end
$$;
create trigger risk_alert after update on public.products for each row when (new.low and not old.low)
  execute function app_private.risk_stock();

-- 轧账不平 (§7.1): the teller's count at 下班 or the count at review differs from the expected notes; one per duty.
create function app_private.risk_cash() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_by text;
  v_diff jsonb;
begin
  if new.review_count is not null and (tg_op = 'INSERT' or old.review_count is null) then
    v_by := 'review';
    v_diff := app_private.cash_diff(new.review_count, new.expected);
  elsif new.teller_count is not null and (tg_op = 'INSERT' or old.teller_count is null) then
    v_by := 'teller';
    v_diff := app_private.cash_diff(new.teller_count, new.expected);
  end if;
  if v_diff is not null and not app_private.cash_balanced(v_diff) then
    perform app_private.risk_alert('cash_unbalanced', 'duty:' || new.duty_id, null, (select user_id from public.duty where id = new.duty_id),
      jsonb_build_object('by', v_by, 'diff', v_diff, 'note', case v_by when 'review' then new.review_note else new.teller_note end));
  end if;
  return null;
exception when others then
  raise warning 'risk alert for duty % not recorded: %', new.duty_id, sqlerrm;
  return null;
end
$$;
create trigger risk_alert after insert or update on public.cash_counts for each row execute function app_private.risk_cash();

-- set_salary_rates as in 20261201000000_attendance_sign_in.sql, with a setting_change alert when the table changes.
create or replace function public.set_salary_rates(p_rates jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_role text;
  v_before jsonb;
  v_after jsonb;
begin
  perform app_private.forbid_president();
  if jsonb_typeof(p_rates) is distinct from 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(p_rates) k)
        is distinct from array['accountant', 'president', 'storekeeper', 'teller'] then
    perform app_private.fail('INVALID_INPUT', '{"field":"rates"}');
  end if;
  for v_role in select jsonb_object_keys(p_rates) loop
    if jsonb_typeof(p_rates -> v_role) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_rates -> v_role) k) is distinct from array['am', 'pm']
       or not app_private.json_int_between(p_rates -> v_role -> 'am', 1, 10000)
       or not app_private.json_int_between(p_rates -> v_role -> 'pm', 1, 10000) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'rates', 'role', v_role));
    end if;
  end loop;
  perform 1 from public.salary_rates for update;
  v_before := app_private.salary_rates();
  update public.salary_rates r set amount = (p_rates -> r.role::text ->> r.shift)::integer, updated_by = v_me, updated_at = now()
  where r.amount <> (p_rates -> r.role::text ->> r.shift)::integer;
  v_after := app_private.salary_rates();
  if v_after <> v_before then
    perform app_private.risk_alert('setting_change', 'salary_rates', null, v_me,
      jsonb_build_object('key', 'salary_rates', 'before', v_before, 'after', v_after));
  end if;
  return v_after;
end
$$;

-- set_setting as in 20261201000000_attendance_sign_in.sql, with risk_rules, and a setting_change alert for each value
-- that changes (§12.1).
create or replace function public.set_setting(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_value jsonb := p_value;
  v_before jsonb;
begin
  perform app_private.forbid_president();
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
  elsif p_key = 'wealth_params' then
    -- the index (sh or sz and 6 digits); factor 0.01–10; weekly base by length 0–100; 1 to 5 tiers, each a key
    -- (lower-case letters, digits, _), a name (1–10 characters), a multiplier 0.1–20 and daily bounds, min −100–0 and max
    -- 0–100; numbers up to 4 decimals
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k) <> array['base', 'factor', 'name', 'symbol', 'tiers']
       or jsonb_typeof(p_value -> 'symbol') <> 'string' or p_value ->> 'symbol' !~ '^(sh|sz)[0-9]{6}$'
       or jsonb_typeof(p_value -> 'name') <> 'string' or length(trim(p_value ->> 'name')) not between 1 and 20
       or not app_private.json_num_between(p_value -> 'factor', 0.01, 10)
       or jsonb_typeof(p_value -> 'base') <> 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value -> 'base') k) <> array['12', '2', '24', '4', '48']
       or exists (select 1 from jsonb_each(p_value -> 'base') e where not app_private.json_num_between(e.value, 0, 100))
       or jsonb_typeof(p_value -> 'tiers') <> 'array' or jsonb_array_length(p_value -> 'tiers') not between 1 and 5
       or exists (select 1 from jsonb_array_elements(p_value -> 'tiers') t
                  where jsonb_typeof(t) <> 'object'
                     or (select array_agg(k order by k) from jsonb_object_keys(t) k) <> array['key', 'max', 'min', 'multiplier', 'name']
                     or jsonb_typeof(t -> 'key') <> 'string' or t ->> 'key' !~ '^[a-z][a-z0-9_]{0,19}$'
                     or jsonb_typeof(t -> 'name') <> 'string' or length(trim(t ->> 'name')) not between 1 and 10
                     or not app_private.json_num_between(t -> 'multiplier', 0.1, 20)
                     or not app_private.json_num_between(t -> 'min', -100, 0)
                     or not app_private.json_num_between(t -> 'max', 0, 100))
       or (select count(distinct t ->> 'key') from jsonb_array_elements(p_value -> 'tiers') t) <> jsonb_array_length(p_value -> 'tiers') then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'risk_rules' then
    -- 风险阈值 (§12.1, §14.3): every key, whole numbers
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k)
          <> array['loan_amount', 'loan_score', 'ops_count', 'ops_minutes', 'reversals', 'withdraw_ratio']
       or not app_private.json_int_between(p_value -> 'loan_amount', 1, 100000)
       or not app_private.json_int_between(p_value -> 'loan_score', 0, 1000)
       or not app_private.json_int_between(p_value -> 'withdraw_ratio', 1, 100)
       or not app_private.json_int_between(p_value -> 'reversals', 1, 100)
       or not app_private.json_int_between(p_value -> 'ops_count', 2, 100)
       or not app_private.json_int_between(p_value -> 'ops_minutes', 1, 1440) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key in ('loan_multiplier', 'penalty_multiplier') then
    -- fixed by the system (§14.3)
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
  else
    perform app_private.fail('INVALID_INPUT', '{"field":"key"}');
  end if;
  select value into v_before from public.settings where key = p_key for update;
  update public.settings set value = v_value, updated_by = v_me, updated_at = now() where key = p_key;
  if v_before is distinct from v_value then
    perform app_private.risk_alert('setting_change', 'settings:' || p_key, null, v_me,
      jsonb_build_object('key', p_key, 'before', v_before, 'after', v_value));
  end if;
  return jsonb_build_object('key', p_key, 'value', v_value);
end
$$;
