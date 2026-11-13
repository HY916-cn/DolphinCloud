-- 信用分开关 (PHASE-2.md §8.5, §14.3): the bank admin turns 信用分 off and on. Off, every student counts 600 and no
-- change is recorded; on again, each student gets back the score they had when it was turned off. Both moves are
-- credit_events (switch_off, switch_on), so the score stays the sum of its events and score_on reads the days before.

-- Whether 信用分 is on; every login reads settings, and only set_credit_enabled writes this row (set_setting refuses it).
insert into public.settings (key, value) values ('credit_enabled', 'true');

-- credit_change as in 20261115000100_interest.sql, with switch_off and switch_on, which take their points like manual;
-- while 信用分 is off it records nothing else and returns null.
create or replace function app_private.credit_change(p_student_no text, p_delta integer, p_rule text, p_reason text,
  p_ref text default null, p_actor uuid default null, p_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_old integer;
  v_new integer;
  v_event public.credit_events;
begin
  if p_rule is null or p_rule not in ('manual', 'switch_off', 'switch_on') and not app_private.setting('credit_rules') ? p_rule
     or p_rule in ('manual', 'switch_off', 'switch_on') and p_delta is null or nullif(trim(p_reason), '') is null then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'rule', 'rule', p_rule));
  end if;
  if p_rule not in ('switch_off', 'switch_on') and app_private.setting('credit_enabled') = 'false' then
    return null;
  end if;
  select score into v_old from public.credit_scores where student_no = p_student_no for update;
  if v_old is null then
    perform app_private.fail('STUDENT_NOT_FOUND');
  end if;
  v_new := greatest(0, least(1000, v_old + coalesce(p_delta, (app_private.setting('credit_rules') ->> p_rule)::integer)));
  if v_new = v_old then
    return null;
  end if;
  insert into public.credit_events (student_no, at, delta, score, rule, reason, ref, actor_id)
  values (p_student_no, p_at, v_new - v_old, v_new, p_rule, trim(p_reason), p_ref, p_actor)
  on conflict (student_no, rule, ref) where ref is not null do nothing
  returning * into v_event;
  if v_event.id is null then
    return null;
  end if;
  update public.credit_scores set score = v_new, updated_at = now() where student_no = p_student_no;
  return to_jsonb(v_event);
end
$$;

-- 信用分开关 (§8.5), the bank admin alone: not the president; turning it off takes a reason. Off: every score not at 600 goes to 600 (switch_off, ref
-- credit_switch:<the time it was turned off>). On: each of those events is undone (switch_on, the same ref). Asking for
-- the state it is already in changes nothing. Logged as credit.switch with the reason.
create function public.set_credit_enabled(p_on boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_reason text := nullif(trim(p_reason), '');
  v_setting public.settings;
  v_at timestamptz := clock_timestamp();  -- each turn its own ref, even two in one transaction
  v_ref text;
  v_n integer := 0;
  r record;
begin
  perform app_private.forbid_president();
  if p_on is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"on"}');
  end if;
  if v_reason is null and not p_on then
    perform app_private.fail('INVALID_INPUT', '{"field":"reason"}');
  end if;
  select * into v_setting from public.settings where key = 'credit_enabled' for update;
  if v_setting.value = to_jsonb(p_on) then
    return jsonb_build_object('enabled', p_on, 'changed', false, 'students', 0);
  end if;
  if p_on then
    v_ref := 'credit_switch:' || extract(epoch from v_setting.updated_at);
    for r in
      select e.student_no, e.score - e.delta - c.score as delta from public.credit_events e join public.credit_scores c using (student_no)
      where e.rule = 'switch_off' and e.ref = v_ref order by e.student_no
    loop
      v_n := v_n + (app_private.credit_change(r.student_no, r.delta, 'switch_on', '信用分重新开启，恢复暂停前的分数', v_ref, v_me) is not null)::integer;
    end loop;
  else
    v_ref := 'credit_switch:' || extract(epoch from v_at);
    for r in select student_no, score from public.credit_scores where score <> 600 order by student_no loop
      v_n := v_n + (app_private.credit_change(r.student_no, 600 - r.score, 'switch_off', '信用分暂停，按 600 分计', v_ref, v_me) is not null)::integer;
    end loop;
  end if;
  update public.settings set value = to_jsonb(p_on), updated_by = v_me, updated_at = v_at where key = 'credit_enabled';
  perform app_private.log('credit.switch', 'settings:credit_enabled', jsonb_build_object('enabled', not p_on),
    jsonb_build_object('enabled', p_on, 'reason', v_reason, 'students', v_n));
  -- M13 风险提醒：信用分修改（对象 settings:credit_enabled）
  return jsonb_build_object('enabled', p_on, 'changed', true, 'students', v_n);
end
$$;
revoke execute on function public.set_credit_enabled(boolean, text) from public, anon;
grant execute on function public.set_credit_enabled(boolean, text) to authenticated;

-- adjust_credit as in 20261114000000_credit.sql, refused with CREDIT_DISABLED while 信用分 is off.
create or replace function public.adjust_credit(p_student_no text, p_delta integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_reason text := nullif(trim(p_reason), '');
  v_status text;
  v_event jsonb;
begin
  perform app_private.forbid_president();
  if app_private.setting('credit_enabled') = 'false' then
    perform app_private.fail('CREDIT_DISABLED');
  end if;
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
