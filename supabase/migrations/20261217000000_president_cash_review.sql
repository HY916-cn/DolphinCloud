-- 复核轧账 (PHASE-2.md §3, §7.1): the president reviews like the bank admin (require_role('teacher') passes a president)
-- and is recorded as the reviewer. The other 轧账 functions and cash_counts' RLS already admit the president.

-- review_cash_count as in 20261203000000_admin_cash_review.sql, for the accountant, the president and the bank admin.
create or replace function public.review_cash_count(p_duty_id uuid, p_count jsonb default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('accountant', 'teacher');
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
