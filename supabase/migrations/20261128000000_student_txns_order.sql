-- 柜台查询 in the order the transactions happened (PHASE-2.md §10.11, P1 §6.8): a 补录 is dated when it happened but
-- written later, so its seq is no guide to where it goes. student_txns as in 20261127000100_manual_entry_functions.sql,
-- newest first by created_at, then seq; p_before is still the seq of the last row of the page before, and the next
-- page is what comes after that row in this order.
create or replace function public.student_txns(p_student_no text, p_before bigint default null, p_limit integer default 10,
  p_from date default null, p_to date default null, p_time_from time default null, p_time_to time default null,
  p_types public.txn_type[] default null, p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_user uuid;
  v_at timestamptz;
  v_like text := '%' || replace(replace(replace(nullif(trim(p_search), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  select user_id into v_user from public.students where student_no = p_student_no;
  if not found then
    perform app_private.fail('STUDENT_NOT_FOUND');
  end if;
  if v_user = v_me then
    perform app_private.fail('SELF_SERVICE_FORBIDDEN');
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    perform app_private.fail('INVALID_INPUT', '{"field":"limit"}');
  end if;
  if p_before is not null then
    select created_at into v_at from public.txns where seq = p_before and student_no = p_student_no;
    if not found then
      perform app_private.fail('INVALID_INPUT', '{"field":"before"}');
    end if;
  end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.seq desc) from (
    select t.seq, t.id, t.txn_no, t.type, t.amount, t.balance_delta, t.balance_after, t.payment, t.status, t.reason,
      t.created_at, p.display_name as operator, t.entered_at,
      (select o.txn_no from public.txns o where o.id = t.corrects) as corrects_no,
      (select n.txn_no from public.txns n where n.corrects = t.id) as corrected_no,
      coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty) order by i.name)
        from public.txn_items i where i.txn_id = t.id), '[]') as items
    from public.txns t join public.profiles p on p.id = t.operator_id
    where t.student_no = p_student_no and (p_before is null or (t.created_at, t.seq) < (v_at, p_before))
      and (p_from is null or t.created_at >= p_from::timestamp at time zone 'Asia/Shanghai')
      and (p_to is null or t.created_at < (p_to + 1)::timestamp at time zone 'Asia/Shanghai')
      and (p_time_from is null or public.cn_time(t) >= p_time_from)
      and (p_time_to is null or public.cn_time(t) < p_time_to)
      and (coalesce(cardinality(p_types), 0) = 0 or t.type = any(p_types))
      and (v_like is null or t.txn_no ilike v_like
        or exists (select 1 from public.txn_items i where i.txn_id = t.id and i.name ilike v_like))
    order by t.created_at desc, t.seq desc limit p_limit) r), '[]');
end
$$;
