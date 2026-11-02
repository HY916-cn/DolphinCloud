-- The counter's 查询 filters a student's transactions as 流水 does: school days p_from..p_to and a 时段 of each day
-- (Asia/Shanghai, the end not included), types, and words found in the 交易号 or a product's name.
drop function public.student_txns(text, bigint, integer);
create function public.student_txns(p_student_no text, p_before bigint default null, p_limit integer default 10,
  p_from date default null, p_to date default null, p_time_from time default null, p_time_to time default null,
  p_types public.txn_type[] default null, p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_user uuid;
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
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.seq desc) from (
    select t.seq, t.id, t.txn_no, t.type, t.amount, t.balance_delta, t.balance_after, t.payment, t.status, t.reason,
      t.created_at, p.display_name as operator,
      coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty) order by i.name)
        from public.txn_items i where i.txn_id = t.id), '[]') as items
    from public.txns t join public.profiles p on p.id = t.operator_id
    where t.student_no = p_student_no and (p_before is null or t.seq < p_before)
      and (p_from is null or t.created_at >= p_from::timestamp at time zone 'Asia/Shanghai')
      and (p_to is null or t.created_at < (p_to + 1)::timestamp at time zone 'Asia/Shanghai')
      and (p_time_from is null or public.cn_time(t) >= p_time_from)
      and (p_time_to is null or public.cn_time(t) < p_time_to)
      and (coalesce(cardinality(p_types), 0) = 0 or t.type = any(p_types))
      and (v_like is null or t.txn_no ilike v_like
        or exists (select 1 from public.txn_items i where i.txn_id = t.id and i.name ilike v_like))
    order by t.seq desc limit p_limit) r), '[]');
end
$$;
grant execute on function public.student_txns(text, bigint, integer, date, date, time, time, public.txn_type[], text) to authenticated;
