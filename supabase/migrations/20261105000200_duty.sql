-- 上班 / 下班 (PHASE-1.md §6.9). A teller serves at the counter only while on duty: 上班 opens a duty, 下班 closes it
-- once the teller has printed and signed the summary of its transactions. For a counted teller, 上班 is the 签到 of
-- the shift of now (and 下班 of the shift it ends in): one attendance row per shift however often they come and go.
-- 考勤 rules: a teller is counted only with a bound 工资账户; a shift is reviewed once; pay waits until every shift up
-- to the week's Sunday is reviewed, and a stopped teller is not paid.

create table public.duty (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id),
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  txns       integer, -- the transactions on the summary the teller signed at 下班
  check ((ended_at is null) = (txns is null))
);
create unique index duty_open on public.duty (user_id) where ended_at is null;
create index on public.duty (user_id, started_at desc);
create trigger audit after insert or update or delete on public.duty for each row execute function app_private.audit_row();
alter table public.duty enable row level security;
grant select on public.duty to authenticated;
create policy read on public.duty for select to authenticated using (user_id = auth.uid() or (select app_private.has_role('teacher')));

-- The shift of a moment, signed for a counted teller; an existing row stays as it is.
create function app_private.sign_shift(p_user_id uuid, p_at timestamptz) returns void
language sql security definer set search_path = '' as $$
  insert into public.attendance (user_id, day, shift, signed_by, signed_at)
  select p_user_id, app_private.cn_date(p_at), app_private.shift_of(p_at), p_user_id, p_at
  from public.staff_payroll where user_id = p_user_id and attendance
  on conflict (user_id, day, shift) do nothing
$$;

-- 上班: opens a duty, or answers the one already open.
create function public.start_duty() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_duty public.duty;
begin
  perform 1 from public.profiles where id = v_me for update;
  select * into v_duty from public.duty where user_id = v_me and ended_at is null;
  if not found then
    insert into public.duty (user_id) values (v_me) returning * into v_duty;
  end if;
  perform app_private.sign_shift(v_me, now());
  return to_jsonb(v_duty);
end
$$;

-- 下班: p_txns is the number of transactions on the summary the teller printed; one made since means printing again.
create function public.end_duty(p_txns integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_duty public.duty;
  v_count integer;
begin
  select * into v_duty from public.duty where user_id = v_me and ended_at is null for update;
  if not found then
    perform app_private.fail('OFF_DUTY');
  end if;
  select count(*) into v_count from public.txns where operator_id = v_me and created_at >= v_duty.started_at;
  if p_txns is distinct from v_count then
    perform app_private.fail('SUMMARY_STALE', jsonb_build_object('txns', v_count));
  end if;
  update public.duty set ended_at = now(), txns = v_count where id = v_duty.id returning * into v_duty;
  perform app_private.sign_shift(v_me, now());
  return to_jsonb(v_duty);
end
$$;

-- Counter business needs a teller on duty; an offline deposit was gated by the counter when it was made.
create function app_private.require_duty() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.type in ('deposit', 'withdraw', 'purchase', 'reversal') and not new.offline
     and exists (select 1 from public.user_roles where user_id = new.operator_id and role = 'teller')
     and not exists (select 1 from public.duty where user_id = new.operator_id and ended_at is null) then
    perform app_private.fail('OFF_DUTY');
  end if;
  return new;
end
$$;
create trigger require_duty before insert on public.txns for each row execute function app_private.require_duty();

drop function public.sign_attendance();

-- 参与考勤 needs a bound 工资账户 and a login in use.
create or replace function public.set_attendance(p_user_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
begin
  perform app_private.require_teller(p_user_id);
  if p_on is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"attendance"}');
  end if;
  if p_on and (select disabled from public.profiles where id = p_user_id) then
    perform app_private.fail('INVALID_INPUT', '{"field":"user_id"}');
  end if;
  if p_on and (select account from public.staff_payroll where user_id = p_user_id) is null then
    perform app_private.fail('SALARY_UNBOUND');
  end if;
  insert into public.staff_payroll as s (user_id, attendance) values (p_user_id, p_on)
  on conflict (user_id) do update set attendance = excluded.attendance where s.attendance <> excluded.attendance;
  return jsonb_build_object('user_id', p_user_id, 'attendance', p_on);
end
$$;

-- A counted teller changes their 工资账户 by binding another; unbinding waits until they are no longer counted.
create or replace function public.unbind_salary_account(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller', 'teacher', 'sysadmin');
begin
  if p_user_id is distinct from v_me and not (app_private.has_role('teacher') or app_private.has_role('sysadmin')) then
    perform app_private.fail('FORBIDDEN', '{"roles":["teacher","sysadmin"]}', '42501');
  end if;
  if (select attendance from public.staff_payroll where user_id = p_user_id) then
    perform app_private.fail('ATTENDANCE_ON');
  end if;
  update public.staff_payroll set account = null where user_id = p_user_id and account is not null;
  return jsonb_build_object('user_id', p_user_id, 'account', null);
end
$$;

-- 审核 (bank admin): a waiting shift is confirmed or rejected once; the decision stands.
create or replace function public.review_attendance(p_ids uuid[], p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_count integer;
begin
  if p_status is null or p_status not in ('confirmed', 'rejected') then
    perform app_private.fail('INVALID_INPUT', '{"field":"status"}');
  end if;
  if coalesce(cardinality(p_ids), 0) = 0 then
    perform app_private.fail('INVALID_INPUT', '{"field":"attendance"}');
  end if;
  perform 1 from public.attendance where id = any(p_ids) order by id for update;
  if exists (select 1 from public.attendance where id = any(p_ids) and status <> 'pending') then
    perform app_private.fail('ATTENDANCE_REVIEWED');
  end if;
  update public.attendance
  set status = p_status, reviewed_by = v_me, reviewed_at = now(), note = coalesce(nullif(trim(p_note), ''), note)
  where id = any(p_ids);
  get diagnostics v_count = row_count;
  return jsonb_build_object('count', v_count);
end
$$;

-- 发放工资 (bank admin) for the week (Monday to Sunday) holding p_week: every confirmed shift not yet paid up to its
-- Sunday, earlier ones included, one salary transaction per teller, once no shift of a teller in use is waiting up to
-- that Sunday. A stopped teller, one with no bound account, or one whose account is frozen or graduated is skipped and
-- paid in a later payout. Paying again pays only shifts confirmed since.
create or replace function public.pay_salaries(p_week date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_from date := p_week - (extract(isodow from p_week)::integer - 1);
  v_to date := v_from + 6;
  v_rates jsonb := app_private.setting('salary_per_shift');
  v_amount integer;
  v_pending integer;
  v_paid jsonb := '[]';
  v_skipped jsonb := '[]';
  v_status text;
  v_account public.accounts;
  v_txn public.txns;
  r record;
begin
  if p_week is null or v_from > app_private.cn_date(now()) then
    perform app_private.fail('INVALID_INPUT', '{"field":"week"}');
  end if;
  perform 1 from public.attendance where salary_txn is null and day <= v_to order by id for update;
  select count(*) into v_pending from public.attendance a join public.profiles p on p.id = a.user_id
  where a.status = 'pending' and a.day <= v_to and not p.disabled;
  if v_pending > 0 then
    perform app_private.fail('ATTENDANCE_PENDING', jsonb_build_object('count', v_pending));
  end if;
  for r in
    select a.user_id, p.display_name, p.disabled, s.account, array_agg(a.id) as ids, count(*)::integer as n,
      count(*) filter (where a.shift = 'am')::integer as n_am, count(*) filter (where a.shift = 'pm')::integer as n_pm,
      min(a.day) as first, max(a.day) as last
    from public.attendance a join public.profiles p on p.id = a.user_id left join public.staff_payroll s on s.user_id = a.user_id
    where a.status = 'confirmed' and a.salary_txn is null and a.day <= v_to
    group by a.user_id, p.display_name, p.disabled, s.account order by p.display_name
  loop
    v_status := (select status from public.students where student_no = r.account);
    if r.disabled or v_status is distinct from 'normal' then
      v_skipped := v_skipped || jsonb_build_object('user_id', r.user_id, 'name', r.display_name, 'shifts', r.n,
        'reason', case when r.disabled then 'disabled' when r.account is null then 'unbound' else 'inactive' end);
      continue;
    end if;
    perform app_private.lock_account(r.account, v_me);
    v_amount := r.n_am * (v_rates ->> 'am')::integer + r.n_pm * (v_rates ->> 'pm')::integer;
    update public.accounts set balance = balance + v_amount, updated_at = now()
    where student_no = r.account returning * into v_account;
    insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, device_id)
    values (gen_random_uuid(), 'salary', r.account, v_amount, v_amount, v_account.balance,
      case when r.first = r.last then to_char(r.first, 'FMMM月FMDD日') else to_char(r.first, 'FMMM月FMDD日') || '至' || to_char(r.last, 'FMMM月FMDD日') end
        || '，' || concat_ws('、', case when r.n_am > 0 then '中午班 ' || r.n_am || ' 个' end, case when r.n_pm > 0 then '下午班 ' || r.n_pm || ' 个' end),
      v_me, app_private.request_header('x-device-id'))
    returning * into v_txn;
    update public.attendance set salary_txn = v_txn.id, pay = (v_rates ->> shift)::integer where id = any(r.ids);
    v_paid := v_paid || jsonb_build_object('user_id', r.user_id, 'name', r.display_name, 'account', r.account,
      'shifts', r.n, 'amount', v_txn.amount, 'txn_no', v_txn.txn_no);
  end loop;
  if jsonb_array_length(v_paid) > 0 then
    perform app_private.log('salary.pay', null, null, jsonb_build_object('from', v_from, 'to', v_to, 'rates', v_rates, 'paid', v_paid));
  end if;
  return jsonb_build_object('from', v_from, 'to', v_to, 'rates', v_rates, 'paid', v_paid, 'skipped', v_skipped);
end
$$;

grant execute on function public.start_duty(), public.end_duty(integer) to authenticated;
