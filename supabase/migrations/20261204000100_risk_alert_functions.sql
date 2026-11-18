-- 风险提醒的处理与查看 (PHASE-2.md §12.2, §15, §16.2): the president and the bank admin mark an alert 已查看 or 终止 it,
-- whoever comes first; 终止 undoes the event in the same transaction, and when the undo fails the alert stays open.

-- One alert as the page shows it: the names of the student, the staff member and the handler, and whether 终止 applies.
create function app_private.risk_alert_json(p public.risk_alerts) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(p) || jsonb_build_object(
    'student_name', (select name from public.students where student_no = p.student_no),
    'staff_name', (select display_name from public.profiles where id = p.staff_id),
    'handler_name', (select display_name from public.profiles where id = p.handled_by),
    'terminable', app_private.risk_terminable(p.kind))
$$;

-- 已查看 (p_note optional) or 终止 (p_note the reason, §12.1):
--   loan_large, loan_overdue: terminate_loan (提前到期, §10.8);
--   withdraw_large, term_early: reverse_txn with the reason 其他：<p_note> (§10.9);
--   reversal_many, ops_frequent: force_end_duty of the duty the teller was on (§7.2);
--   setting_change: the value before, while the value is still the one the alert recorded (ALERT_OUTDATED otherwise);
--   credit_adjust: a manual event of the opposite delta, ref risk_alerts:<id> (CREDIT_DISABLED while 信用分 is off).
-- Returns {"alert", "result"}, result being what the undo returned (null for 已查看).
create function public.handle_alert(p_id bigint, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_note text := nullif(btrim(p_note), '');
  v_alert public.risk_alerts;
  v_ref text;
  v_result jsonb;
begin
  if p_action is null or p_action not in ('seen', 'terminate') then
    perform app_private.fail('INVALID_INPUT', '{"field":"action"}');
  end if;
  if char_length(v_note) > 200 then
    perform app_private.fail('INVALID_INPUT', '{"field":"note"}');
  end if;
  select * into v_alert from public.risk_alerts where id = p_id for update;
  if not found then
    perform app_private.fail('INVALID_INPUT', '{"field":"id"}');
  end if;
  if v_alert.status <> 'open' then
    perform app_private.fail('ALERT_HANDLED', jsonb_build_object('status', v_alert.status, 'handled_at', v_alert.handled_at,
      'handler_name', (select display_name from public.profiles where id = v_alert.handled_by)));
  end if;
  if p_action = 'terminate' then
    if not app_private.risk_terminable(v_alert.kind) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'action', 'kind', v_alert.kind));
    end if;
    if v_note is null then
      perform app_private.fail('INVALID_INPUT', '{"field":"note"}');
    end if;
    v_ref := split_part(v_alert.target, ':', 2);
    if v_alert.kind in ('loan_large', 'loan_overdue') then
      v_result := public.terminate_loan(v_ref::uuid, v_note);
    elsif v_alert.kind in ('withdraw_large', 'term_early') then
      v_result := public.reverse_txn(gen_random_uuid(), v_ref::uuid, '其他：' || v_note);
    elsif v_alert.kind in ('reversal_many', 'ops_frequent') then
      v_result := public.force_end_duty((v_alert.detail ->> 'duty_id')::uuid, v_note);
    elsif v_alert.kind = 'setting_change' and v_alert.target = 'salary_rates' then
      perform 1 from public.salary_rates for update;
      if app_private.salary_rates() <> v_alert.detail -> 'after' then
        perform app_private.fail('ALERT_OUTDATED', '{"key":"salary_rates"}');
      end if;
      update public.salary_rates r set amount = (v_alert.detail #>> array['before', r.role::text, r.shift])::integer,
        updated_by = v_me, updated_at = now()
      where r.amount <> (v_alert.detail #>> array['before', r.role::text, r.shift])::integer;
      v_result := jsonb_build_object('key', 'salary_rates', 'value', app_private.salary_rates());
    elsif v_alert.kind = 'setting_change' then
      update public.settings set value = v_alert.detail -> 'before', updated_by = v_me, updated_at = now()
      where key = v_ref and value = v_alert.detail -> 'after';
      if not found then
        perform app_private.fail('ALERT_OUTDATED', jsonb_build_object('key', v_ref));
      end if;
      v_result := jsonb_build_object('key', v_ref, 'value', v_alert.detail -> 'before');
    else  -- credit_adjust
      if app_private.setting('credit_enabled') = 'false' then
        perform app_private.fail('CREDIT_DISABLED');
      end if;
      v_result := app_private.credit_change(v_alert.student_no, -(v_alert.detail ->> 'delta')::integer, 'manual',
        '风险提醒终止：' || v_note, 'risk_alerts:' || v_alert.id, v_me);
      if v_result is null then        -- the score is already at 0 or 1000 that way
        perform app_private.fail('INVALID_INPUT', '{"field":"delta"}');
      end if;
      v_result := jsonb_build_object('event', v_result, 'credit', app_private.credit_info(v_alert.student_no));
    end if;
  end if;
  update public.risk_alerts set status = case p_action when 'seen' then 'seen' else 'terminated' end,
    handled_by = v_me, handled_at = now(), note = v_note
  where id = p_id returning * into v_alert;
  return jsonb_build_object('alert', app_private.risk_alert_json(v_alert), 'result', v_result);
end
$$;
revoke execute on function public.handle_alert(bigint, text, text) from public, anon;
grant execute on function public.handle_alert(bigint, text, text) to authenticated;

-- The 风险提醒 page (§16.2): alerts newest first, by status, kind and the day they were raised (Shanghai), p_limit
-- (1–200) at a time below the id p_before.
create function public.list_risk_alerts(p_status text[] default null, p_kind text[] default null, p_from date default null,
  p_to date default null, p_before bigint default null, p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_role('teacher');
  if not p_status <@ array['open', 'seen', 'terminated'] then
    perform app_private.fail('INVALID_INPUT', '{"field":"status"}');
  end if;
  if not p_kind <@ app_private.risk_kinds() then
    perform app_private.fail('INVALID_INPUT', '{"field":"kind"}');
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    perform app_private.fail('INVALID_INPUT', '{"field":"limit"}');
  end if;
  return coalesce((select jsonb_agg(app_private.risk_alert_json(a) order by a.id desc) from (
    select * from public.risk_alerts
    where (p_status is null or status = any(p_status)) and (p_kind is null or kind = any(p_kind))
      and (p_from is null or app_private.cn_date(at) >= p_from) and (p_to is null or app_private.cn_date(at) <= p_to)
      and (p_before is null or id < p_before)
    order by id desc limit p_limit) a), '[]');
end
$$;
revoke execute on function public.list_risk_alerts(text[], text[], date, date, bigint, integer) from public, anon;
grant execute on function public.list_risk_alerts(text[], text[], date, date, bigint, integer) to authenticated;

-- 总览 and 看板 (§16.2): how many alerts are open, and the 5 newest of them.
create function public.risk_alert_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_role('teacher');
  return jsonb_build_object(
    'open', (select count(*) from public.risk_alerts where status = 'open'),
    'recent', coalesce((select jsonb_agg(app_private.risk_alert_json(a) order by a.id desc) from (
      select * from public.risk_alerts where status = 'open' order by id desc limit 5) a), '[]'));
end
$$;
revoke execute on function public.risk_alert_overview() from public, anon;
grant execute on function public.risk_alert_overview() to authenticated;
