-- 风险提醒的处理 (PHASE-2.md §3, §12.2): only the bank admin marks an alert 已查看 or terminates it; the president
-- reads the alerts and the overview as before.

-- handle_alert as in 20261204000100_risk_alert_functions.sql, refusing the president.
create or replace function public.handle_alert(p_id bigint, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_note text := nullif(btrim(p_note), '');
  v_alert public.risk_alerts;
  v_ref text;
  v_result jsonb;
begin
  perform app_private.forbid_president();
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
