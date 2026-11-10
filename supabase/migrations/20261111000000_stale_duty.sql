-- 跨天未下班 (PHASE-1.md §6.9): a duty begun before today (Asia/Shanghai) takes no more counter business until the
-- teller ends it. 上班 answers it, marked stale, instead of opening another; 下班 ends it as any duty, and the next 上班
-- opens a new one.

-- 上班: opens a duty, or answers the one already open; `stale` says it was begun before today.
create or replace function public.start_duty() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_duty public.duty;
  v_stale boolean;
begin
  perform 1 from public.profiles where id = v_me for update;
  select * into v_duty from public.duty where user_id = v_me and ended_at is null;
  if not found then
    insert into public.duty (user_id) values (v_me) returning * into v_duty;
  end if;
  v_stale := app_private.cn_date(v_duty.started_at) < app_private.cn_date(now());
  if not v_stale then
    perform app_private.sign_shift(v_me, now());
  end if;
  return to_jsonb(v_duty) || jsonb_build_object('stale', v_stale);
end
$$;

-- Counter business needs a teller on duty since today; an offline deposit was gated by the counter when it was made.
create or replace function app_private.require_duty() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_started timestamptz;
begin
  if new.type in ('deposit', 'withdraw', 'purchase', 'reversal') and not new.offline
     and exists (select 1 from public.user_roles where user_id = new.operator_id and role = 'teller') then
    v_started := (select started_at from public.duty where user_id = new.operator_id and ended_at is null);
    if v_started is null then
      perform app_private.fail('OFF_DUTY');
    elsif app_private.cn_date(v_started) < app_private.cn_date(now()) then
      perform app_private.fail('STALE_DUTY', jsonb_build_object('started_at', v_started));
    end if;
  end if;
  return new;
end
$$;
