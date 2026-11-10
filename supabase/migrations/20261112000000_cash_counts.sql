-- 备用金 and the 下班总结 cash table (PHASE-2.md §4, §7.1, §7.3, §14.2): 上班 records the notes in the cash box, the
-- summary counts by denomination what came in and went out since, and 下班 keeps the expected notes for 轧账 (M12 adds
-- the teller's count and the accountant's review to the same row).

create table public.cash_counts (
  duty_id      uuid primary key references public.duty(id),
  float        jsonb not null,                -- 备用金 {"1":20,"2":10,...}
  expected     jsonb,                         -- 下班时算出的应有
  teller_count jsonb,                         -- 柜员实点
  teller_note  text,
  review_count jsonb,                         -- 财务实点（与柜员不同时）
  review_note  text,
  reviewed_by  uuid references public.profiles(id),
  reviewed_at  timestamptz,
  status       text not null default 'open' check (status in ('open','pending','done','forced'))
);
create trigger audit after insert or update or delete on public.cash_counts for each row execute function app_private.audit_row();
alter table public.cash_counts enable row level security;
grant select on public.cash_counts to authenticated;
create policy read on public.cash_counts for select to authenticated using (
  exists (select 1 from public.duty d where d.id = duty_id and d.user_id = auth.uid())
  or (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));

-- Notes by denomination: every configured denomination, 0 where p_cash has none.
create function app_private.cash_notes(p_cash jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_object_agg(d, coalesce(p_cash -> d, '0')) from jsonb_array_elements_text(app_private.setting('denominations')) d
$$;

-- The notes a transaction brought into the cash box (income) and took out of it (payout). A reversal moves the notes of
-- the transaction it reverses the other way. Cash loans and repayments (M11) add their cases here.
create function app_private.txn_cash(p_txn public.txns) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_orig jsonb;
begin
  case
    when p_txn.type = 'deposit' then
      return jsonb_strip_nulls(jsonb_build_object('income', p_txn.denominations));
    when p_txn.type = 'withdraw' then
      return jsonb_strip_nulls(jsonb_build_object('payout', p_txn.denominations));
    when p_txn.type = 'purchase' and p_txn.payment = 'cash' then
      return jsonb_strip_nulls(jsonb_build_object('income', p_txn.denominations, 'payout', p_txn.change_given));
    when p_txn.type = 'reversal' then
      v_orig := (select app_private.txn_cash(o) from public.txns o where o.id = p_txn.reversal_of);
      return jsonb_strip_nulls(jsonb_build_object('income', v_orig -> 'payout', 'payout', v_orig -> 'income'));
    else
      return '{}';
  end case;
end
$$;

-- The cash of a duty by denomination: the teller's transactions from 上班 to 下班, less every transaction reversed within
-- the same duty and its reversal. A reversal of an earlier duty's transaction counts here, and that duty stays as it was.
create function app_private.duty_cash(p_duty public.duty) returns jsonb
language sql stable security definer set search_path = '' as $$
  with w as (
    select t.id, t.reversal_of, app_private.txn_cash(t) as c from public.txns t
    where t.operator_id = p_duty.user_id and t.created_at >= p_duty.started_at
      and (p_duty.ended_at is null or t.created_at <= p_duty.ended_at)
  ), counted as (
    select c from w
    where not exists (select 1 from w r where r.reversal_of = w.id) and not exists (select 1 from w o where o.id = w.reversal_of)
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
  from (select kind, jsonb_build_object('counts', jsonb_object_agg(note::text, n), 'amounts', jsonb_object_agg(note::text, note * n),
      'total', sum(note * n)) as part
    from sums group by kind) s
$$;

-- 上班: opens a duty with its 备用金 (p_float, or else the teller's last one, or else none), or answers the one already
-- open as it is; `stale` says it was begun before today.
drop function public.start_duty();
create function public.start_duty(p_float jsonb default null) returns jsonb
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
      v_float := (select c.float from public.cash_counts c join public.duty d on d.id = c.duty_id
        where d.user_id = v_me order by d.started_at desc limit 1);
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

-- 下班: p_txns is the number of transactions on the summary the teller printed; one made since means printing again.
-- The expected notes wait for 轧账.
create or replace function public.end_duty(p_txns integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_duty public.duty;
  v_count integer;
  v_cash jsonb;
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
  v_cash := app_private.duty_cash(v_duty);
  insert into public.cash_counts (duty_id, float, expected, status)
  values (v_duty.id, v_cash -> 'float' -> 'counts', v_cash -> 'expected' -> 'counts', 'pending')
  on conflict (duty_id) do update set expected = excluded.expected, status = excluded.status;
  perform app_private.sign_shift(v_me, now());
  return to_jsonb(v_duty);
end
$$;

-- 下班总结的现金表: the caller's open duty, or any duty for the accountant, president and bank admin.
create function public.duty_cash(p_duty_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller', 'accountant', 'teacher');
  v_duty public.duty;
begin
  if p_duty_id is null then
    select * into v_duty from public.duty where user_id = v_me and ended_at is null;
    if not found then
      perform app_private.fail('OFF_DUTY');
    end if;
  else
    select * into v_duty from public.duty where id = p_duty_id;
    if not found then
      perform app_private.fail('INVALID_INPUT', '{"field":"duty_id"}');
    end if;
    if v_duty.user_id <> v_me and not (app_private.has_role('accountant') or app_private.has_role('teacher')) then
      perform app_private.fail('FORBIDDEN', '{"roles":["accountant","president","teacher"]}', '42501');
    end if;
  end if;
  return jsonb_build_object('duty_id', v_duty.id, 'user_id', v_duty.user_id, 'started_at', v_duty.started_at,
      'ended_at', v_duty.ended_at,
      'status', coalesce((select status from public.cash_counts where duty_id = v_duty.id), case when v_duty.ended_at is null then 'open' end))
    || app_private.duty_cash(v_duty);
end
$$;

grant execute on function public.start_duty(jsonb), public.duty_cash(uuid) to authenticated;
