-- 更正 (PHASE-2.md §10.11): the original goes out first unless it added to 活期 (a 存款, an 调账 up) and the student
-- stays the same, so a 兑换 paid in cash (0 to 活期) gives its stock back before the corrected one takes it: with none
-- left, a correction of the note or the student alone still saves.

-- correct_txn as in 20261127000100_manual_entry_functions.sql, reversing first when the original moved 活期 by 0 too.
create or replace function public.correct_txn(p_id uuid, p_original_id uuid, p_new jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_orig public.txns;
  v_rev public.txns;
  v_txn public.txns;
  v_no text;
begin
  perform app_private.forbid_president();
  if p_reason is null or not (p_reason in ('金额录错', '学号录错', '业务选错') or p_reason ~ '^其他[：:]\s*\S') then
    perform app_private.fail('INVALID_INPUT', '{"field":"reason"}');
  end if;
  if jsonb_typeof(p_new) is distinct from 'object' or jsonb_typeof(p_new -> 'student_no') not in ('string', 'null')
     or jsonb_typeof(p_new -> 'type') not in ('string', 'null') then
    perform app_private.fail('INVALID_INPUT', '{"field":"new"}');
  end if;
  if jsonb_typeof(p_new -> 'amount') <> 'null' and not app_private.json_int_between(p_new -> 'amount', -100000, 100000) then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  perform 1 from public.job_runs where job = 'daily' for update;
  select * into v_txn from public.txns where id = p_id;
  if found then
    return app_private.correct_result(v_txn);
  end if;
  select * into v_orig from public.txns where id = p_original_id for update;
  if not found then
    perform app_private.fail('TXN_NOT_FOUND');
  end if;
  if v_orig.status <> 'normal' or v_orig.type not in ('deposit', 'withdraw', 'purchase', 'adjust') then
    perform app_private.fail('REVERSAL_NOT_ALLOWED');
  end if;
  v_no := coalesce(p_new ->> 'student_no', v_orig.student_no);
  perform app_private.manual_account(least(v_orig.student_no, v_no), v_me);
  perform app_private.manual_account(greatest(v_orig.student_no, v_no), v_me);
  perform app_private.manual_check_at(v_orig.student_no, v_orig.created_at);
  perform app_private.manual_check_at(v_no, v_orig.created_at);

  if v_orig.balance_delta <= 0 or v_no <> v_orig.student_no then
    v_rev := app_private.manual_reverse(v_orig, p_reason, v_me);
  end if;
  v_txn := app_private.manual_post(p_id, v_no, coalesce(p_new ->> 'type', v_orig.type::text), (p_new ->> 'amount')::numeric::integer,
    p_new ->> 'payment', nullif(p_new -> 'denominations', 'null'), nullif(p_new -> 'items', 'null'), v_orig.created_at,
    '更正：' || p_reason, v_orig.id, v_me);
  if v_rev.id is null then
    v_rev := app_private.manual_reverse(v_orig, p_reason, v_me);
  end if;

  if v_no = v_orig.student_no then
    perform app_private.manual_check_history(v_no, v_orig.created_at, v_txn.balance_delta + v_rev.balance_delta);
  else
    perform app_private.manual_check_history(v_orig.student_no, v_orig.created_at, v_rev.balance_delta);
    perform app_private.manual_check_history(v_no, v_orig.created_at, v_txn.balance_delta);
  end if;
  perform app_private.correct_interest(n, app_private.cn_date(v_orig.created_at), v_txn.id)
  from (select distinct unnest(array[v_orig.student_no, v_no]) as n) x;
  -- M13 风险提醒：每笔更正记一条提醒（对象 txns:<原流水 id>）
  perform app_private.log('txn.correct', 'txns:' || v_orig.id, to_jsonb(v_orig), app_private.correct_result(v_txn));
  return app_private.correct_result(v_txn);
end
$$;
