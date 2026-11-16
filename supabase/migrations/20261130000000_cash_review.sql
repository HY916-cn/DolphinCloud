-- 轧账 (PHASE-2.md §7): 下班 records the teller's count by denomination and compares it with the expected notes, the
-- accountant reviews it, and the president or bank admin can force a teller off duty, whose count the accountant then
-- enters at review. The next 上班 starts from the last count. Also: the loan detail carries its penalty rate.

alter table public.cash_counts
  add column forced_by     uuid references public.profiles(id), -- 强制下班的人
  add column forced_reason text;
comment on column public.cash_counts.review_count is '财务录入的实点；为空表示与柜员一致';

-- The transactions whose cash counts in a duty: the teller's from 上班 to 下班, less every transaction reversed within
-- the same duty and its reversal (§7.3).
create function app_private.duty_cash_txns(p_duty public.duty) returns setof public.txns
language sql stable security definer set search_path = '' as $$
  with w as (
    select t.* from public.txns t
    where t.operator_id = p_duty.user_id and t.created_at >= p_duty.started_at
      and (p_duty.ended_at is null or t.created_at <= p_duty.ended_at)
  )
  select w.* from w
  where not exists (select 1 from w r where r.reversal_of = w.id) and not exists (select 1 from w o where o.id = w.reversal_of)
$$;

-- duty_cash as in 20261112000000_cash_counts.sql, over duty_cash_txns, with cash_txns: each transaction that moved
-- cash, by time, for the teller to check against the count.
create or replace function app_private.duty_cash(p_duty public.duty) returns jsonb
language sql stable security definer set search_path = '' as $$
  with counted as (
    select app_private.txn_cash(t) as c from app_private.duty_cash_txns(p_duty) t
  ), lines as (
    select 'float' as kind, e.key::integer as note, e.value::integer as n
    from public.cash_counts k, jsonb_each_text(k.float) e where k.duty_id = p_duty.id
    union all select 'income', e.key::integer, e.value::integer from counted, jsonb_each_text(counted.c -> 'income') e
    union all select 'payout', e.key::integer, e.value::integer from counted, jsonb_each_text(counted.c -> 'payout') e
  ), notes as (
    select d::integer as note from jsonb_array_elements_text(app_private.setting('denominations')) d
    union select note from lines
  ), base as (
    select k.kind, n.note, coalesce(sum(l.n), 0)::integer as n
    from notes n cross join (values ('float'), ('income'), ('payout')) k(kind)
    left join lines l on l.kind = k.kind and l.note = n.note
    group by k.kind, n.note
  ), sums as (
    select kind, note, n from base
    union all select 'expected', note, sum(case kind when 'payout' then -n else n end)::integer from base group by note
  )
  select jsonb_build_object('denominations', (select jsonb_agg(note order by note) from notes))
    || jsonb_object_agg(kind, part)
    || jsonb_build_object('cash_txns', (
      select coalesce(jsonb_agg(jsonb_build_object('txn_no', t.txn_no, 'created_at', t.created_at, 'type', t.type,
          'student_no', t.student_no, 'name', s.name, 'amount', t.amount, 'payment', t.payment, 'status', t.status,
          'income', app_private.txn_cash(t) -> 'income', 'payout', app_private.txn_cash(t) -> 'payout') order by t.created_at, t.seq), '[]')
      from app_private.duty_cash_txns(p_duty) t left join public.students s on s.student_no = t.student_no
      where app_private.txn_cash(t) <> '{}'))
  from (select kind, jsonb_build_object('counts', jsonb_object_agg(note::text, n), 'amounts', jsonb_object_agg(note::text, note * n),
      'total', sum(note * n)) as part
    from sums group by kind) s
$$;

-- Count less expected, by denomination (more notes than expected above 0).
create function app_private.cash_diff(p_count jsonb, p_expected jsonb) returns jsonb
language sql immutable strict as $$
  select jsonb_object_agg(k, coalesce((p_count ->> k)::integer, 0) - coalesce((p_expected ->> k)::integer, 0))
  from (select jsonb_object_keys(p_count) union select jsonb_object_keys(p_expected)) n(k)
$$;

create function app_private.cash_balanced(p_diff jsonb) returns boolean
language sql immutable strict as $$
  select coalesce(bool_and(value::integer = 0), true) from jsonb_each_text(p_diff)
$$;

-- The HTB of {"denomination": count}, counts below 0 included.
create function app_private.cash_sum(p_cash jsonb) returns integer
language sql immutable strict as $$
  select coalesce(sum(key::integer * value::integer), 0)::integer from jsonb_each_text(p_cash)
$$;

-- The 备用金 a teller's next 上班 begins from (§7.1): the last count (the accountant's when they entered one, else the
-- teller's), or else the last 备用金, or else none; every denomination.
create function app_private.default_float(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.cash_notes(coalesce((select coalesce(c.review_count, c.teller_count, c.float)
    from public.cash_counts c join public.duty d on d.id = c.duty_id
    where d.user_id = p_user_id order by d.started_at desc limit 1), '{}'))
$$;

-- The 上班 card's 备用金 before 上班.
create function public.default_float() returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.default_float(app_private.require_role('teller'))
$$;

-- A duty's 轧账 for the 轧账 page (§7, §16.2): count is the accountant's when they entered one, else the teller's; diff
-- and balanced are null without a count; the *_total are in HTB; overdue is a duty not yet reviewed the day after 下班;
-- reversed lists the transactions of this duty reversed later (in a later duty, or by the president or bank admin), with
-- the time of each.
create function app_private.cash_count_json(p_duty_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('duty_id', d.id, 'user_id', d.user_id, 'name', u.display_name, 'started_at', d.started_at,
      'ended_at', d.ended_at, 'status', c.status, 'float', c.float, 'expected', c.expected,
      'teller_count', c.teller_count, 'teller_note', c.teller_note, 'review_count', c.review_count, 'review_note', c.review_note,
      'count', x.cnt, 'diff', x.diff, 'balanced', app_private.cash_balanced(x.diff),
      'expected_total', app_private.cash_sum(c.expected), 'teller_total', app_private.cash_sum(c.teller_count),
      'count_total', app_private.cash_sum(x.cnt), 'diff_total', app_private.cash_sum(x.diff),
      'reviewed_by', c.reviewed_by, 'reviewer_name', r.display_name, 'reviewed_at', c.reviewed_at,
      'forced_by', c.forced_by, 'forced_reason', c.forced_reason,
      'overdue', c.status in ('pending', 'forced') and app_private.cn_date(d.ended_at) < app_private.cn_date(now()),
      'reversed', (select coalesce(jsonb_agg(jsonb_build_object('txn_no', t.txn_no, 'reversed_at', coalesce(v.entered_at, v.created_at))
          order by coalesce(v.entered_at, v.created_at)), '[]')
        from app_private.duty_cash_txns(d) t join public.txns v on v.reversal_of = t.id))
  from public.cash_counts c
    join public.duty d on d.id = c.duty_id
    join public.profiles u on u.id = d.user_id
    left join public.profiles r on r.id = c.reviewed_by
    cross join lateral (select coalesce(c.review_count, c.teller_count) as cnt) y
    cross join lateral (select y.cnt, app_private.cash_diff(y.cnt, c.expected) as diff) x
  where c.duty_id = p_duty_id
$$;

-- start_duty as in 20261112000000_cash_counts.sql, the 备用金 by default from default_float.
create or replace function public.start_duty(p_float jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_duty public.duty;
  v_float jsonb;
  v_stale boolean;
begin
  perform 1 from public.profiles where id = v_me for update;
  select * into v_duty from public.duty where user_id = v_me and ended_at is null;
  if not found then
    if p_float is null then
      v_float := app_private.default_float(v_me);
    else
      perform app_private.cash_total(p_float);
      v_float := p_float;
    end if;
    insert into public.duty (user_id) values (v_me) returning * into v_duty;
    insert into public.cash_counts (duty_id, float) values (v_duty.id, app_private.cash_notes(coalesce(v_float, '{}')));
  end if;
  v_stale := app_private.cn_date(v_duty.started_at) < app_private.cn_date(now());
  if not v_stale then
    perform app_private.sign_shift(v_me, now());
  end if;
  return to_jsonb(v_duty) || jsonb_build_object('stale', v_stale,
    'float', app_private.cash_notes(coalesce((select c.float from public.cash_counts c where c.duty_id = v_duty.id), '{}')));
end
$$;

-- 下班 (end_duty as in 20261112000000_cash_counts.sql): p_count is the teller's count of the cash box by denomination,
-- compared with the expected notes; when they differ p_note says why. Without p_count nothing is compared and the
-- accountant enters the count at review. Returns the duty, its 轧账 and its cash transactions.
drop function public.end_duty(integer);
create function public.end_duty(p_txns integer, p_count jsonb default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_note text := nullif(btrim(p_note), '');
  v_duty public.duty;
  v_count integer;
  v_notes jsonb;
  v_cash jsonb;
  v_diff jsonb;
begin
  select * into v_duty from public.duty where user_id = v_me and ended_at is null for update;
  if not found then
    perform app_private.fail('OFF_DUTY');
  end if;
  select count(*) into v_count from public.txns where operator_id = v_me and created_at >= v_duty.started_at;
  if p_txns is distinct from v_count then
    perform app_private.fail('SUMMARY_STALE', jsonb_build_object('txns', v_count));
  end if;
  if p_count is not null then
    perform app_private.cash_total(p_count);
    v_notes := app_private.cash_notes(p_count);
  end if;
  if char_length(v_note) > 200 then
    perform app_private.fail('INVALID_INPUT', '{"field":"note"}');
  end if;
  update public.duty set ended_at = now(), txns = v_count where id = v_duty.id returning * into v_duty;
  v_cash := app_private.duty_cash(v_duty);
  v_diff := app_private.cash_diff(v_notes, v_cash -> 'expected' -> 'counts');
  if not app_private.cash_balanced(v_diff) then
    if v_note is null then
      perform app_private.fail('NOTE_REQUIRED', jsonb_build_object('diff', v_diff));
    end if;
    -- M13: a cash_unbalanced risk alert for this duty (§12.1).
  end if;
  insert into public.cash_counts (duty_id, float, expected, teller_count, teller_note, status)
  values (v_duty.id, v_cash -> 'float' -> 'counts', v_cash -> 'expected' -> 'counts', v_notes, v_note, 'pending')
  on conflict (duty_id) do update
    set expected = excluded.expected, teller_count = excluded.teller_count, teller_note = excluded.teller_note, status = excluded.status;
  perform app_private.sign_shift(v_me, now());
  return to_jsonb(v_duty) || app_private.cash_count_json(v_duty.id) || jsonb_build_object('cash_txns', v_cash -> 'cash_txns');
end
$$;

-- 复核 (§7.1): p_count null agrees with the teller's count; otherwise the accountant's count stands and, when it differs
-- from the teller's (from the expected notes for a duty without one), p_note says why. A duty is reviewed once.
create function public.review_cash_count(p_duty_id uuid, p_count jsonb default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('accountant');
  v_note text := nullif(btrim(p_note), '');
  v_row public.cash_counts;
  v_notes jsonb;
  v_diff jsonb;
begin
  select * into v_row from public.cash_counts where duty_id = p_duty_id for update;
  if not found then
    perform app_private.fail('INVALID_INPUT', '{"field":"duty_id"}');
  end if;
  if v_row.status not in ('pending', 'forced') then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'duty_id', 'status', v_row.status));
  end if;
  if char_length(v_note) > 200 then
    perform app_private.fail('INVALID_INPUT', '{"field":"note"}');
  end if;
  if p_count is null then
    if v_row.teller_count is null then
      perform app_private.fail('INVALID_INPUT', '{"field":"count"}');
    end if;
  else
    perform app_private.cash_total(p_count);
    v_notes := app_private.cash_notes(p_count);
    v_diff := app_private.cash_diff(v_notes, v_row.expected);
    if v_note is null and not app_private.cash_balanced(app_private.cash_diff(v_notes, coalesce(v_row.teller_count, v_row.expected))) then
      perform app_private.fail('NOTE_REQUIRED', jsonb_build_object('diff', v_diff));
    end if;
    if not app_private.cash_balanced(v_diff) then
      -- M13: a cash_unbalanced risk alert for this duty (§12.1).
    end if;
  end if;
  update public.cash_counts set review_count = v_notes, review_note = v_note, reviewed_by = v_me, reviewed_at = now(), status = 'done'
  where duty_id = p_duty_id;
  return app_private.cash_count_json(p_duty_id);
end
$$;

-- 强制下班 (§7.2, §12.2): ends a teller's open duty with its expected notes and no count; the accountant counts the cash
-- box at review. M13's 终止 of a risk alert calls this. No shift is signed for the teller: the one signed at 上班 stays
-- for the bank admin's review as usual.
create function public.force_end_duty(p_duty_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_reason text := nullif(btrim(p_reason), '');
  v_duty public.duty;
  v_cash jsonb;
begin
  select * into v_duty from public.duty where id = p_duty_id for update;
  if not found or v_duty.ended_at is not null then
    perform app_private.fail('INVALID_INPUT', jsonb_strip_nulls(jsonb_build_object('field', 'duty_id',
      'status', (select status from public.cash_counts where duty_id = p_duty_id))));
  end if;
  if v_reason is null or char_length(v_reason) > 200 then
    perform app_private.fail('INVALID_INPUT', '{"field":"reason"}');
  end if;
  update public.duty set ended_at = now(),
    txns = (select count(*) from public.txns where operator_id = v_duty.user_id and created_at >= v_duty.started_at)
  where id = v_duty.id returning * into v_duty;
  v_cash := app_private.duty_cash(v_duty);
  insert into public.cash_counts (duty_id, float, expected, status, forced_by, forced_reason)
  values (v_duty.id, v_cash -> 'float' -> 'counts', v_cash -> 'expected' -> 'counts', 'forced', v_me, v_reason)
  on conflict (duty_id) do update
    set expected = excluded.expected, status = excluded.status, forced_by = excluded.forced_by, forced_reason = excluded.forced_reason;
  return app_private.cash_count_json(v_duty.id);
end
$$;

-- The 轧账 page (§16.2): duties by teller, by the day 上班 began (Shanghai) and by status, latest first.
create function public.cash_reviews(p_user_id uuid default null, p_from date default null, p_to date default null,
  p_status text[] default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_role('accountant', 'teacher');
  if not p_status <@ array['open', 'pending', 'done', 'forced'] then
    perform app_private.fail('INVALID_INPUT', '{"field":"status"}');
  end if;
  return coalesce((select jsonb_agg(app_private.cash_count_json(d.id) order by d.started_at desc)
    from public.cash_counts c join public.duty d on d.id = c.duty_id
    where (p_user_id is null or d.user_id = p_user_id)
      and (p_from is null or app_private.cn_date(d.started_at) >= p_from)
      and (p_to is null or app_private.cn_date(d.started_at) <= p_to)
      and (p_status is null or c.status = any(p_status))), '[]');
end
$$;

-- 财务总览 (§16.2): how many duties wait for review (pending or forced), how many of them are overdue, and the 5 that
-- have waited longest.
create function public.cash_review_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_role('accountant', 'teacher');
  return (with w as (
    select d.id, d.ended_at from public.cash_counts c join public.duty d on d.id = c.duty_id where c.status in ('pending', 'forced')
  )
  select jsonb_build_object('pending', count(*), 'overdue', count(*) filter (where app_private.cn_date(ended_at) < app_private.cn_date(now())),
    'oldest', coalesce((select jsonb_agg(app_private.cash_count_json(o.id) order by o.ended_at)
      from (select * from w order by ended_at limit 5) o), '[]'))
  from w);
end
$$;

revoke execute on function public.default_float(), public.end_duty(integer, jsonb, text), public.review_cash_count(uuid, jsonb, text),
  public.force_end_duty(uuid, text), public.cash_reviews(uuid, date, date, text[]), public.cash_review_overview() from public, anon;
grant execute on function public.default_float(), public.end_duty(integer, jsonb, text), public.review_cash_count(uuid, jsonb, text),
  public.force_end_duty(uuid, text), public.cash_reviews(uuid, date, date, text[]), public.cash_review_overview() to authenticated;

-- loan_json as in 20261119000100_loans.sql, with penalty_rate: the weekly rate the overdue principal accrues at.
create or replace function app_private.loan_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(l) || jsonb_build_object(
    'penalty_rate', app_private.penalty_rate(l.rate),
    'payoff', case when l.status in ('active', 'overdue') then l.remaining + ceil(l.interest_centi / 100.0)::integer end,
    'next', (select jsonb_build_object('seq', p.seq, 'due_on', p.due_on, 'amount', app_private.loan_due(l, p.due_on))
             from public.loan_periods p where p.loan_id = l.id and p.paid < p.principal and l.status in ('active', 'overdue')
             order by p.seq limit 1),
    'schedule', (select jsonb_agg(to_jsonb(p) - 'loan_id' order by p.seq) from public.loan_periods p where p.loan_id = l.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('txn_id', t.id, 'txn_no', t.txn_no, 'created_at', t.created_at,
        'amount', t.amount, 'interest', p.interest, 'principal', p.principal, 'auto', p.auto, 'payment', t.payment, 'status', t.status)
        order by t.seq), '[]')
      from public.loan_payments p join public.txns t on t.id = p.txn_id where p.loan_id = l.id))
  from public.loans l where l.id = p_id
$$;
