-- 登记货币发行 is the bank admin's alone (PHASE-2.md §3): the president is refused (FORBIDDEN).
-- register_issue, as in 20261106000100_issue_date.sql.
create or replace function public.register_issue(p_batch_no text, p_issued_on date, p_denominations jsonb,
  p_purpose text, p_approver_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_total integer := app_private.cash_total(p_denominations);
  v_issue public.currency_issues;
begin
  perform app_private.forbid_president();
  if v_total <= 0 then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  if nullif(trim(p_batch_no), '') is null or p_issued_on is null
     or nullif(trim(p_purpose), '') is null or nullif(trim(p_approver_name), '') is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"issue"}');
  end if;
  if p_issued_on > app_private.cn_date(now()) then
    perform app_private.fail('INVALID_INPUT', '{"field":"issued_on"}');
  end if;
  if exists (select 1 from public.currency_issues where batch_no = trim(p_batch_no)) then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"batch_no"}');
  end if;
  insert into public.currency_issues (batch_no, issued_on, denominations, total, purpose, approver_name, created_by)
  values (trim(p_batch_no), p_issued_on, p_denominations, v_total, trim(p_purpose), trim(p_approver_name), v_me)
  returning * into v_issue;
  return to_jsonb(v_issue);
end
$$;
