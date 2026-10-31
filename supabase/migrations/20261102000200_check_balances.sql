-- The ledger self-check also covers the balance_after chain, the account totals and purchase items (PHASE-1.md §5.4).
-- Kinds: account (balance vs Σ balance_delta), product (stock vs Σ qty_delta), balance_after (per txn, previous
-- balance_after + balance_delta in seq order), total_in / total_out / total_spent (per account, the normal, not reversed
-- deposits and openings / withdrawals / account-paid purchases, as the RPCs keep them), txn_items (purchase amount vs
-- Σ unit_price × qty). key is the student number, product id or txn_no.
create or replace function app_private.check_balances() returns table (kind text, key text, recorded integer, expected bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(r), '[]') into v_rows from (
    select 'account' as kind, a.student_no as key, a.balance as recorded, coalesce(sum(t.balance_delta), 0) as expected
    from public.accounts a left join public.txns t on t.student_no = a.student_no
    group by a.student_no, a.balance having a.balance <> coalesce(sum(t.balance_delta), 0)
    union all
    select 'product', p.id::text, p.stock, coalesce(sum(m.qty_delta), 0)
    from public.products p left join public.stock_movements m on m.product_id = p.id
    group by p.id, p.stock having p.stock <> coalesce(sum(m.qty_delta), 0)
    union all
    select 'balance_after', c.txn_no, c.balance_after, c.expected
    from (select txn_no, balance_after,
            coalesce(lag(balance_after) over (partition by student_no order by seq), 0)::bigint + balance_delta as expected
          from public.txns) c
    where c.balance_after <> c.expected
    union all
    select x.kind, x.key, x.recorded, x.expected
    from (select a.student_no, a.total_in, a.total_out, a.total_spent,
            coalesce(sum(t.amount) filter (where t.type in ('deposit', 'opening')), 0) as e_in,
            coalesce(sum(t.amount) filter (where t.type = 'withdraw'), 0) as e_out,
            coalesce(sum(t.amount) filter (where t.type = 'purchase' and t.payment = 'account'), 0) as e_spent
          from public.accounts a left join public.txns t on t.student_no = a.student_no and t.status = 'normal'
          group by a.student_no) s,
      lateral (values ('total_in', s.student_no, s.total_in, s.e_in), ('total_out', s.student_no, s.total_out, s.e_out),
                      ('total_spent', s.student_no, s.total_spent, s.e_spent)) x(kind, key, recorded, expected)
    where x.recorded <> x.expected
    union all
    select 'txn_items', t.txn_no, t.amount, coalesce(sum(i.unit_price * i.qty), 0)
    from public.txns t left join public.txn_items i on i.txn_id = t.id
    where t.type = 'purchase'
    group by t.id, t.txn_no, t.amount having t.amount <> coalesce(sum(i.unit_price * i.qty), 0)
  ) r;
  if jsonb_array_length(v_rows) > 0 then
    perform app_private.log('check.mismatch', null, null, v_rows);
  end if;
  return query select * from jsonb_to_recordset(v_rows) as x(kind text, key text, recorded integer, expected bigint);
end
$$;
