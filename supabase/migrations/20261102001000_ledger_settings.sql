-- Ledger details and settings:
-- - a withdrawal records the notes paid out (txns.denominations, largest notes first, as the counter shows them), and
--   every result returns them;
-- - the transaction number keeps the whole sequence number (at least 6 digits), so it can never repeat;
-- - set_settings saves several settings in one transaction, all or none.

create or replace function app_private.txns_number() returns trigger language plpgsql as $$
begin
  new.txn_no := coalesce(new.txn_no,
    'HT' || to_char(new.created_at at time zone 'Asia/Shanghai', 'YYMMDD') || lpad(new.seq::text, greatest(length(new.seq::text), 6), '0'));
  return new;
end
$$;

create or replace function app_private.txn_result(p_txn public.txns) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', p_txn.id, 'txn_no', p_txn.txn_no, 'type', p_txn.type, 'amount', p_txn.amount,
    'balance_after', p_txn.balance_after, 'denominations', p_txn.denominations, 'change_given', p_txn.change_given,
    'created_at', p_txn.created_at)
$$;

create or replace function public.withdraw(p_id uuid, p_student_no text, p_amount integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_account public.accounts := app_private.lock_account(p_student_no, v_me);
  v_single integer := app_private.division_limit('withdraw_single_limit', p_student_no);
  v_daily integer := app_private.division_limit('withdraw_daily_limit', p_student_no);
  v_today integer;
  v_txn public.txns;
begin
  select * into v_txn from public.txns where id = p_id;
  if found then
    return app_private.txn_result(v_txn);
  end if;
  if p_amount is null or p_amount <= 0 then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  if p_amount > v_single then
    perform app_private.fail('WITHDRAW_SINGLE_LIMIT', jsonb_build_object('limit', v_single));
  end if;
  v_today := app_private.withdrawn_today(p_student_no);
  if v_today + p_amount > v_daily then
    perform app_private.fail('WITHDRAW_DAILY_LIMIT',
      jsonb_build_object('limit', v_daily, 'remaining', greatest(v_daily - v_today, 0)));
  end if;
  if p_amount > v_account.balance then
    perform app_private.fail('INSUFFICIENT_BALANCE',
      jsonb_build_object('balance', v_account.balance, 'short', p_amount - v_account.balance));
  end if;
  update public.accounts set balance = balance - p_amount, total_out = total_out + p_amount, updated_at = now()
  where student_no = p_student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, denominations, operator_id, device_id)
  values (p_id, 'withdraw', p_student_no, p_amount, -p_amount, v_account.balance, -p_amount, app_private.make_change(p_amount),
    v_me, app_private.request_header('x-device-id'))
  returning * into v_txn;
  return app_private.txn_result(v_txn);
end
$$;

-- p_values: {"key": value, ...}; each one is checked by set_setting. Returns the saved values.
create function public.set_settings(p_values jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_key text;
  v_saved jsonb := '{}';
begin
  if jsonb_typeof(p_values) is distinct from 'object' or p_values = '{}' then
    perform app_private.fail('INVALID_INPUT', '{"field":"values"}');
  end if;
  for v_key in select jsonb_object_keys(p_values) loop
    v_saved := v_saved || jsonb_build_object(v_key, public.set_setting(v_key, p_values -> v_key) -> 'value');
  end loop;
  return v_saved;
end
$$;
grant execute on function public.set_settings(jsonb) to authenticated;
