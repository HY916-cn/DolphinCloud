-- 海豚信用分 (PHASE-2.md §8, §14.2, §14.3): one score per student, 0–1000, 600 at 开户; every change is a credit_events
-- row written by app_private.credit_change. The 额度 and the loan and saving factors follow the score continuously
-- through the credit_curve setting; the weekly rules run in run_weekly; the bank admin adjusts by hand.

create table public.credit_scores (           -- 每位学生当前的信用分
  student_no text primary key references public.students(student_no),
  score      integer not null default 600 check (score between 0 and 1000),
  updated_at timestamptz not null default now()
);

create table public.credit_events (           -- 每次变动
  id         bigserial primary key,
  student_no text not null references public.students(student_no),
  at         timestamptz not null default now(),
  delta      integer not null,                -- the change applied, after keeping the score within 0–1000
  score      integer not null,                -- 变动后
  rule       text not null,                   -- credit_rules 里的键，手动调整为 manual
  reason     text not null,
  ref        text,                            -- weeks:<周一>、loans:<id>…、risk_alerts:<id>
  actor_id   uuid references public.profiles(id)
);
create index on public.credit_events (student_no, at desc);
-- One change per student, rule and ref: a week, a loan's period or an alert is never counted twice.
create unique index credit_events_once on public.credit_events (student_no, rule, ref) where ref is not null;
create trigger append_only before update or delete on public.credit_events for each row execute function app_private.append_only();

-- Every student starts at 600, those already there included; a student added later (名册导入) starts at 600 too.
insert into public.credit_scores (student_no) select student_no from public.students;
create function app_private.open_credit() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.credit_scores (student_no) values (new.student_no);
  return null;
end
$$;
create trigger open_credit after insert on public.students for each row execute function app_private.open_credit();

alter table public.credit_scores enable row level security;
alter table public.credit_events enable row level security;
grant select on public.credit_scores, public.credit_events to authenticated;
-- The student their own; the accountant, president and bank admin everyone's (§3). The teller sees the score of the
-- student at the counter through lookup_student.
create policy read on public.credit_scores for select to authenticated using (
  student_no = (select app_private.my_student_no())
  or (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));
create policy read on public.credit_events for select to authenticated using (
  student_no = (select app_private.my_student_no())
  or (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));

-- §14.3. credit_curve: 能贷款的最低分, 额度两端 and 取整单位, 贷款系数两端 (at min_score and at 1000), 储蓄系数两端 (at 0 and
-- at 1000). credit_rules: the points of each rule in §8.2.
insert into public.settings (key, value) values
  ('credit_curve', '{"min_score":400,"limit_min":50,"limit_max":300,"limit_step":5,"loan_max":1.8,"loan_min":1.1,"saving_min":0.8,"saving_max":1.2}'),
  ('credit_rules', '{"repay_on_time":5,"repay_early":10,"overdue":-50,"overdue_week":-30,"deposit_week":3,"deposit_streak":10,"withdraw_half":-5,"account_age":2,"balance_100":2,"balance_300":2}');

-- The rules each M milestone calls by key; gains are 0–100 points, losses −100–0.
create function app_private.credit_rule_signs() returns jsonb language sql immutable as $$
  select '{"repay_on_time":1,"repay_early":1,"overdue":-1,"overdue_week":-1,"deposit_week":1,"deposit_streak":1,"withdraw_half":-1,"account_age":1,"balance_100":1,"balance_300":1}'::jsonb
$$;

-- 贷款额度 (§8.1): 50 + (分数 − 400) ÷ 600 × 250, down to a multiple of 5 HTB; null below 400. Integer arithmetic, so
-- a limit that is exactly a multiple of the step is never lost to rounding.
create function app_private.credit_limit(p_score integer) returns integer
language sql stable security definer set search_path = '' as $$
  select case when p_score >= m then
    ((c ->> 'limit_min')::integer * (1000 - m) + (p_score - m) * ((c ->> 'limit_max')::integer - (c ->> 'limit_min')::integer))
      / ((1000 - m) * (c ->> 'limit_step')::integer) * (c ->> 'limit_step')::integer
  end
  from (select app_private.setting('credit_curve') c) s, lateral (select (c ->> 'min_score')::integer m) x
$$;

-- 贷款系数: 1.8 at 400 down to 1.1 at 1000, 4 decimals; null below 400.
create function app_private.loan_factor(p_score integer) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when p_score >= m then
    round((c ->> 'loan_max')::numeric - (p_score - m) * ((c ->> 'loan_max')::numeric - (c ->> 'loan_min')::numeric) / (1000 - m), 4)
  end
  from (select app_private.setting('credit_curve') c) s, lateral (select (c ->> 'min_score')::integer m) x
$$;

-- 储蓄系数: 0.8 at 0 up to 1.2 at 1000, 4 decimals. M9 multiplies the 活期 rate by it.
create function app_private.saving_factor(p_score integer) returns numeric
language sql stable security definer set search_path = '' as $$
  select round((c ->> 'saving_min')::numeric + p_score * ((c ->> 'saving_max')::numeric - (c ->> 'saving_min')::numeric) / 1000, 4)
  from (select app_private.setting('credit_curve') c) s
$$;

-- 「再涨 N 分，额度加 5 HTB」: the fewest points that raise the limit by one step; null below min_score and at the top limit.
create function app_private.credit_next(p_score integer) returns integer
language sql stable security definer set search_path = '' as $$
  select case when l is not null and l < app_private.credit_limit(1000) then
    -- the least score s with limit_min·D + (s − m)·R ≥ (l + step)·D, where D = 1000 − m and R = limit_max − limit_min
    m + ((l + (c ->> 'limit_step')::integer - (c ->> 'limit_min')::integer) * (1000 - m) + r - 1) / r - p_score
  end
  from (select app_private.setting('credit_curve') c) s,
    lateral (select (c ->> 'min_score')::integer m, (c ->> 'limit_max')::integer - (c ->> 'limit_min')::integer r,
      app_private.credit_limit(p_score) l) x
$$;

-- A student's score with what it gives (§8.4): what credit_profile, lookup_student and M11's loan_quote show.
create function app_private.credit_info(p_student_no text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('student_no', student_no, 'score', score, 'loan_limit', app_private.credit_limit(score),
    'points_to_next', app_private.credit_next(score), 'loan_factor', app_private.loan_factor(score),
    'saving_factor', app_private.saving_factor(score))
  from public.credit_scores where student_no = p_student_no
$$;

-- 信用分 for the student app (no argument: their own) and the back office (a student number: the accountant, president
-- and bank admin). The teller reads it in lookup_student.
create function public.credit_profile(p_student_no text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_no text := app_private.my_student_no();
begin
  if p_student_no is null or p_student_no is not distinct from v_no then
    if v_no is null then
      perform app_private.fail('FORBIDDEN', '{"roles":["student"]}', '42501');
    end if;
  else
    perform app_private.require_role('accountant', 'teacher');
    v_no := p_student_no;
    if not exists (select 1 from public.students where student_no = v_no) then
      perform app_private.fail('STUDENT_NOT_FOUND');
    end if;
  end if;
  return app_private.credit_info(v_no);
end
$$;
grant execute on function public.credit_profile(text) to authenticated;

-- The one way a score changes. p_delta null takes the points of p_rule from credit_rules (M11's repayment rules call it
-- so); manual is the bank admin's adjustment. The score stays within 0–1000 and the event records the change applied.
-- A change of 0 writes nothing; a change already recorded for the same student, rule and ref is skipped. Returns the
-- event, or null when nothing was written.
create function app_private.credit_change(p_student_no text, p_delta integer, p_rule text, p_reason text,
  p_ref text default null, p_actor uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_old integer;
  v_new integer;
  v_event public.credit_events;
begin
  if p_rule is null or p_rule <> 'manual' and not app_private.setting('credit_rules') ? p_rule
     or p_rule = 'manual' and p_delta is null or nullif(trim(p_reason), '') is null then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'rule', 'rule', p_rule));
  end if;
  select score into v_old from public.credit_scores where student_no = p_student_no for update;
  if v_old is null then
    perform app_private.fail('STUDENT_NOT_FOUND');
  end if;
  v_new := greatest(0, least(1000, v_old + coalesce(p_delta, (app_private.setting('credit_rules') ->> p_rule)::integer)));
  if v_new = v_old then
    return null;
  end if;
  insert into public.credit_events (student_no, delta, score, rule, reason, ref, actor_id)
  values (p_student_no, v_new - v_old, v_new, p_rule, trim(p_reason), p_ref, p_actor)
  on conflict (student_no, rule, ref) where ref is not null do nothing
  returning * into v_event;
  if v_event.id is null then
    return null;
  end if;
  update public.credit_scores set score = v_new, updated_at = now() where student_no = p_student_no;
  return to_jsonb(v_event);
end
$$;

-- 活期 at the end of the day (Asia/Shanghai): the balance after the student's last transaction that day or before.
create function app_private.balance_on(p_student_no text, p_day date) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select balance_after from public.txns
    where student_no = p_student_no and created_at < (p_day + 1)::timestamp at time zone 'Asia/Shanghai'
    order by seq desc limit 1), 0)
$$;

-- 每周加减分 (§8.2) for the week before the Monday p_week, from run_weekly. Students in 冻结、毕业、注销 are left as they
-- are. Deposits are 柜台存款 not reversed before p_week; the streak counts calendar weeks back from last week. Everything
-- reads p_week and the transactions before it, never now(), and each event's ref is weeks:<p_week>, so a week already
-- counted is skipped and a catch-up gives what the Mondays would have.
create function app_private.credit_weekly(p_week date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_from timestamptz := (p_week - 7)::timestamp at time zone 'Asia/Shanghai';
  v_to timestamptz := p_week::timestamp at time zone 'Asia/Shanghai';
  v_ref text := 'weeks:' || p_week;
  v_n integer := 0;
  r record;
begin
  for r in
    with counted as (               -- 柜台存款 and 取款 not reversed by p_week
      select t.student_no, t.type, t.amount, t.created_at, app_private.cn_date(t.created_at) as day from public.txns t
      where t.type in ('deposit', 'withdraw') and t.created_at < v_to
        and not exists (select 1 from public.txns x where x.reversal_of = t.id and x.created_at < v_to)
    ), last_week as (
      select student_no, bool_or(type = 'deposit') as deposited, coalesce(sum(amount) filter (where type = 'withdraw'), 0) as withdrawn
      from counted where created_at >= v_from group by student_no
    ), streaks as (                 -- weeks with a deposit, counted back from last week until one without
      select student_no, count(*) filter (where w = p_week - 7 * k) as streak
      from (select student_no, w, (row_number() over (partition by student_no order by w desc))::integer as k
            from (select distinct student_no, day - (extract(isodow from day)::integer - 1) as w from counted where type = 'deposit') d) x
      group by student_no
    )
    select s.student_no, app_private.cn_date(s.opened_at) as opened, coalesce(l.deposited, false) as deposited,
      coalesce(k.streak, 0) as streak, coalesce(l.withdrawn, 0) as withdrawn,
      app_private.balance_on(s.student_no, p_week - 8) as start_balance,
      -- 日均余额 by the end of each day; M10 adds each day's 定期本金 here
      (select sum(app_private.balance_on(s.student_no, d::date)) from generate_series(p_week - 7, p_week - 1, interval '1 day') d) as balance_sum
    from public.students s left join last_week l using (student_no) left join streaks k using (student_no)
    where s.status = 'normal' and app_private.cn_date(s.opened_at) < p_week
    order by s.student_no
  loop
    if r.deposited then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'deposit_week', '上周有存款', v_ref) is not null)::integer;
    end if;
    if r.streak > 0 and r.streak % 4 = 0 then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'deposit_streak', '连续 ' || r.streak || ' 周都有存款', v_ref) is not null)::integer;
    end if;
    if r.withdrawn * 2 > r.start_balance then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'withdraw_half', '上周取款超过周初余额的一半', v_ref) is not null)::integer;
    end if;
    if (p_week - r.opened) / 28 > (p_week - 7 - r.opened) / 28 then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'account_age', '开户满 ' || (p_week - r.opened) / 28 * 4 || ' 周', v_ref) is not null)::integer;
    end if;
    if r.balance_sum >= 700 then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'balance_100', '上周日均余额不少于 100 HTB', v_ref) is not null)::integer;
    end if;
    if r.balance_sum >= 2100 then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'balance_300', '上周日均余额不少于 300 HTB', v_ref) is not null)::integer;
    end if;
  end loop;
  return v_n;
end
$$;

-- run_weekly as in 20261113000000_terms_jobs.sql, with 信用分的每周加减分 in its place. A term's first Monday counts no
-- week: the week before it was in the holidays.
create or replace function app_private.run_weekly(p_week date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_done date;
  v_term public.terms := app_private.current_term(p_week);
  v_first boolean := v_term.starts_on > p_week - 7;
begin
  select done_to into v_done from public.job_runs where job = 'weekly' for update;
  if p_week <= v_done then
    return jsonb_build_object('job', 'weekly', 'day', p_week, 'status', 'skipped');
  end if;
  if extract(isodow from p_week) <> 1 or p_week > v_done + 7
     or (select done_to from public.job_runs where job = 'daily') < p_week - 1 then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'week'));
  end if;
  if v_term.id is not null then
    -- In term, in this order (§13):
    -- M9 活期结息（上周的利息）
    if not v_first then
      perform app_private.credit_weekly(p_week);
      -- M11 逾期后仍未还清每满一周：credit_change(student_no, null, 'overdue_week', '贷款逾期满 N 周', 'loans:<id>:' || p_week)
    end if;
    -- M9 计算并公布本周锚点；v_first 时不调整，沿用放假前的锚点
  end if;
  update public.job_runs set done_to = p_week, last_ok = now(), last_err = null where job = 'weekly';
  return jsonb_build_object('job', 'weekly', 'day', p_week, 'status', case when v_term.id is null then 'holiday' else 'done' end,
    'term_id', v_term.id, 'first', coalesce(v_first, false));
end
$$;

-- 手动调整 (§8.3), the bank admin alone: not the president. Logged as credit.adjust.
create function public.adjust_credit(p_student_no text, p_delta integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_reason text := nullif(trim(p_reason), '');
  v_status text;
  v_event jsonb;
begin
  perform app_private.forbid_president();
  if v_reason is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"reason"}');
  end if;
  if p_delta is null or p_delta = 0 or p_delta not between -1000 and 1000 then
    perform app_private.fail('INVALID_INPUT', '{"field":"delta"}');
  end if;
  select status into v_status from public.students where student_no = p_student_no;
  if v_status is null then
    perform app_private.fail('STUDENT_NOT_FOUND');
  end if;
  if v_status = 'closed' then
    perform app_private.fail('ACCOUNT_CLOSED');
  end if;
  v_event := app_private.credit_change(p_student_no, p_delta, 'manual', '银行管理员调整：' || v_reason, null, v_me);
  if v_event is null then           -- already at 0 or 1000
    perform app_private.fail('INVALID_INPUT', '{"field":"delta"}');
  end if;
  perform app_private.log('credit.adjust', 'students:' || p_student_no, null, v_event);
  -- M13 风险提醒 credit_adjust（对象 credit_events:<id>；「终止」= credit_change 记一条 −delta 的 manual 变动，ref risk_alerts:<id>）
  return jsonb_build_object('event', v_event, 'credit', app_private.credit_info(p_student_no));
end
$$;
grant execute on function public.adjust_credit(text, integer, text) to authenticated;

-- A number with at most 4 decimals in [p_min, p_max].
create function app_private.json_num_between(p_value jsonb, p_min numeric, p_max numeric) returns boolean
language sql immutable as $$
  select case when jsonb_typeof(p_value) = 'number'
              then p_value::numeric = round(p_value::numeric, 4) and p_value::numeric between p_min and p_max
              else false end
$$;

-- set_setting as in 20261104000200_shift_pay.sql, with credit_curve and credit_rules (§14.3; the president and the
-- bank admin, §3).
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
  else
    perform app_private.fail('INVALID_INPUT', '{"field":"key"}');
  end if;
  update public.settings set value = v_value, updated_by = v_me, updated_at = now() where key = p_key;
  -- M13 风险提醒 setting_change：利率参数、credit_curve、credit_rules、风险阈值、取款限额（对象 settings:<key>；「终止」恢复修改前的值）
  return jsonb_build_object('key', p_key, 'value', v_value);
end
$$;

-- lookup_student as in 20261105000100_accounts.sql, with the student's credit (§16.1: the gauge on the counter's card).
create or replace function public.lookup_student(p_student_no text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
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
  return jsonb_build_object('student_no', v_student.student_no, 'name', v_student.name, 'division', v_student.division,
    'cohort', v_student.cohort, 'class_no', v_student.class_no, 'grade', public.grade(v_student),
    'class_label', public.class_label(v_student), 'status', v_student.status,
    'balance', (select balance from public.accounts where student_no = p_student_no),
    'withdrawn_today', app_private.withdrawn_today(p_student_no),
    'credit', app_private.credit_info(p_student_no) - 'student_no');
end
$$;
