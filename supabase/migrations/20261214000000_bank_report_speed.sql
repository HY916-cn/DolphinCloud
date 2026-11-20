-- 报表 at full school size (PHASE-1.md §10: one year of 2000 students within 5 s). bank_report as in
-- 20261206000100_currency_functions.sql, with three changes that leave every number as it was:
-- jit off (the estimate over the year's transactions reaches the JIT thresholds, and compiling took longer than the
-- query); the system user read once, so the 业务 count tests app_private.is_business's conditions on each transaction
-- without two security definer calls per row; and currency_state once for 发行 and 银行应有现金.
create or replace function public.bank_report(p_from date, p_to date, p_division text default null, p_cohort integer default null,
  p_class_no integer default null, p_student_no text default null, p_time_from time default null, p_time_to time default null)
returns jsonb language plpgsql stable security definer set search_path = '' set jit = off as $$
declare
  v_me uuid := app_private.require_role('accountant', 'teacher');
  v_start timestamptz := p_from::timestamp at time zone 'Asia/Shanghai';
  v_end timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Shanghai';
  v_system uuid := app_private.system_user();
  v_paper jsonb;
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    perform app_private.fail('INVALID_INPUT', '{"field":"period"}');
  end if;
  if p_time_from >= p_time_to then
    perform app_private.fail('INVALID_INPUT', '{"field":"time"}');
  end if;
  v_paper := app_private.currency_state(p_to) -> 'paper';
  return (
    with scope as (
      select s.student_no, s.division, s.cohort, s.class_no, s.status, public.class_label(s) as class_label
      from public.students s
      -- Students opened by the end of the period; one with a transaction before then counts whatever opened_at says.
      where (s.opened_at < v_end or exists (select 1 from public.txns x where x.student_no = s.student_no and x.created_at < v_end))
        and (p_division is null or s.division = p_division) and (p_cohort is null or s.cohort = p_cohort)
        and (p_class_no is null or s.class_no = p_class_no) and (p_student_no is null or s.student_no = p_student_no)
    ),
    whole_days as (
      select x.* from public.txns x join scope using (student_no) where x.created_at >= v_start and x.created_at < v_end
    ),
    t as (
      select * from whole_days x
      where (p_time_from is null or public.cn_time(x) >= p_time_from) and (p_time_to is null or public.cn_time(x) < p_time_to)
    ),
    live as (select * from t where status = 'normal' and type in ('deposit', 'withdraw', 'purchase')),
    opening as (
      select x.student_no, sum(x.balance_delta) as balance
      from public.txns x join scope using (student_no) where x.created_at < v_start group by x.student_no
    ),
    closing as (
      select x.student_no, sum(x.balance_delta) as balance
      from public.txns x join scope using (student_no) where x.created_at < v_end group by x.student_no
    ),
    per_student as (
      select student_no, count(*) as n,
        coalesce(sum(amount) filter (where type = 'deposit'), 0) as deposit,
        coalesce(sum(amount) filter (where type = 'withdraw'), 0) as withdraw,
        coalesce(sum(amount) filter (where type = 'purchase' and payment = 'account'), 0) as spent
      from live group by student_no
    ),
    holders as (
      select s.*, coalesce(c.balance, 0) as balance, coalesce(p.n, 0) as n, coalesce(p.deposit, 0) as deposit,
        coalesce(p.withdraw, 0) as withdraw, coalesce(p.spent, 0) as spent
      from scope s left join closing c using (student_no) left join per_student p using (student_no)
    )
    select jsonb_build_object(
      'business', (select jsonb_build_object(
        'deposit', jsonb_build_object('count', count(*) filter (where type = 'deposit'),
          'amount', coalesce(sum(amount) filter (where type = 'deposit'), 0)),
        'withdraw', jsonb_build_object('count', count(*) filter (where type = 'withdraw'),
          'amount', coalesce(sum(amount) filter (where type = 'withdraw'), 0)),
        'purchase_account', jsonb_build_object('count', count(*) filter (where type = 'purchase' and payment = 'account'),
          'amount', coalesce(sum(amount) filter (where type = 'purchase' and payment = 'account'), 0)),
        'purchase_cash', jsonb_build_object('count', count(*) filter (where type = 'purchase' and payment = 'cash'),
          'amount', coalesce(sum(amount) filter (where type = 'purchase' and payment = 'cash'), 0)),
        'students', count(distinct student_no)) from live),
      'loans', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from t
        where type = 'loan' and status = 'normal'),
      'repays', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(x.amount), 0),
          'principal', coalesce(sum(p.principal), 0), 'interest', coalesce(sum(p.interest), 0))
        from t x join public.loan_payments p on p.txn_id = x.id where x.type = 'repay' and x.status = 'normal'),
      'interest', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from t
        where type = 'interest' and status = 'normal'),
      'terms', (select jsonb_build_object(
          'open', jsonb_build_object('count', count(*) filter (where x.type = 'term_open'),
            'amount', coalesce(sum(x.amount) filter (where x.type = 'term_open'), 0)),
          'close', jsonb_build_object('count', count(*) filter (where x.type = 'term_close'),
            'amount', coalesce(sum(x.amount) filter (where x.type = 'term_close'), 0),
            'interest', coalesce(sum(x.amount - d.principal) filter (where x.type = 'term_close'), 0)))
        from t x join public.term_deposits d on d.id = x.term_id
        where x.type in ('term_open', 'term_close') and x.status = 'normal'),
      -- app_private.is_business(t), with the system user read once.
      'operations', (select jsonb_build_object('count', count(*)) from t where status = 'normal' and operator_id <> v_system
        and type in ('deposit', 'withdraw', 'purchase', 'loan', 'repay', 'term_open', 'term_close', 'wealth_buy', 'wealth_close')),
      'holdings', (select jsonb_build_object(
          'term', coalesce(sum(d.principal * case when o.type = 'term_open' then 1 else -1 end * x.sign)
            filter (where o.type in ('term_open', 'term_close')), 0),
          'wealth', coalesce(sum(w.principal * case when o.type = 'wealth_buy' then 1 else -1 end * x.sign)
            filter (where o.type in ('wealth_buy', 'wealth_close')), 0),
          'loans', coalesce(sum(case when o.type = 'loan' then o.amount else -p.principal end * x.sign)
            filter (where o.type in ('loan', 'repay')), 0))
        from (select x.*, case when x.type = 'reversal' then -1 else 1 end as sign
              from public.txns x join scope using (student_no) where x.created_at < v_end
                and (x.term_id is not null or x.wealth_id is not null or x.loan_id is not null or x.type = 'reversal')) x
        join public.txns o on o.id = coalesce(x.reversal_of, x.id)
        left join public.term_deposits d on d.id = o.term_id
        left join public.wealth_holdings w on w.id = o.wealth_id
        left join public.loan_payments p on p.txn_id = o.id),
      'adjust', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(balance_delta), 0)) from t
        where type = 'adjust' and status = 'normal'),
      'reversals', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from t where type = 'reversal'),
      'reversed', (select count(*) from t where status = 'reversed'),
      'openings', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from t where type = 'opening'),
      'balance', jsonb_build_object(
        'opening', (select coalesce(sum(balance), 0) from opening),
        'closing', (select coalesce(sum(balance), 0) from closing),
        'changes', (select coalesce(jsonb_object_agg(type, delta), '{}') from (
          select type, sum(balance_delta) as delta from whole_days group by type) d)),
      'cash', (select jsonb_build_object('in', coalesce(sum(cash_delta) filter (where cash_delta > 0), 0),
        'out', coalesce(-sum(cash_delta) filter (where cash_delta < 0), 0)) from t),
      'days', (select jsonb_agg(jsonb_build_object('day', g.day,
          'deposit', coalesce(d.deposit, 0), 'deposit_count', coalesce(d.deposit_count, 0),
          'withdraw', coalesce(d.withdraw, 0), 'withdraw_count', coalesce(d.withdraw_count, 0),
          'purchase', coalesce(d.purchase, 0), 'purchase_count', coalesce(d.purchase_count, 0),
          'students', coalesce(d.students, 0), 'change', coalesce(e.change, 0)) order by g.day)
        from (select generate_series(p_from, p_to, interval '1 day')::date as day) g
        left join (select app_private.cn_date(created_at) as day, sum(balance_delta) as change from whole_days group by 1) e using (day)
        left join (select app_private.cn_date(created_at) as day,
            coalesce(sum(amount) filter (where type = 'deposit'), 0) as deposit, count(*) filter (where type = 'deposit') as deposit_count,
            coalesce(sum(amount) filter (where type = 'withdraw'), 0) as withdraw, count(*) filter (where type = 'withdraw') as withdraw_count,
            coalesce(sum(amount) filter (where type = 'purchase'), 0) as purchase, count(*) filter (where type = 'purchase') as purchase_count,
            count(distinct student_no) as students
          from live group by 1) d using (day)),
      'hours', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'count', n) order by h), '[]') from (
        select extract(hour from created_at at time zone 'Asia/Shanghai')::integer as h, count(*) as n from live group by 1) x),
      'tellers', (select coalesce(jsonb_agg(jsonb_build_object('name', p.display_name, 'count', x.n,
          'deposit_count', x.deposit_count, 'deposit', x.deposit, 'withdraw_count', x.withdraw_count, 'withdraw', x.withdraw,
          'purchase_count', x.purchase_count, 'purchase', x.purchase, 'reversed', x.reversed, 'reversals', x.reversals)
          order by x.n desc, p.display_name), '[]')
        from (select operator_id,
            count(*) filter (where status = 'normal' and type in ('deposit', 'withdraw', 'purchase')) as n,
            count(*) filter (where status = 'normal' and type = 'deposit') as deposit_count,
            coalesce(sum(amount) filter (where status = 'normal' and type = 'deposit'), 0) as deposit,
            count(*) filter (where status = 'normal' and type = 'withdraw') as withdraw_count,
            coalesce(sum(amount) filter (where status = 'normal' and type = 'withdraw'), 0) as withdraw,
            count(*) filter (where status = 'normal' and type = 'purchase') as purchase_count,
            coalesce(sum(amount) filter (where status = 'normal' and type = 'purchase'), 0) as purchase,
            count(*) filter (where status = 'reversed' and type <> 'opening') as reversed,
            count(*) filter (where type = 'reversal') as reversals
          from t where type <> 'opening' and operator_id <> v_system group by operator_id) x
        join public.profiles p on p.id = x.operator_id),
      'classes', (select coalesce(jsonb_agg(to_jsonb(c) order by c.division desc, c.cohort desc, c.class_no), '[]') from (
        select division, cohort, class_no, class_label, count(*) as students, count(*) filter (where n > 0) as active,
          sum(balance) as balance, sum(deposit) as deposit, sum(withdraw) as withdraw, sum(spent) as spent
        from holders group by division, cohort, class_no, class_label) c),
      'students', (select jsonb_build_object('total', count(*), 'active', count(*) filter (where n > 0),
          'normal', count(*) filter (where status = 'normal'), 'frozen', count(*) filter (where status = 'frozen'),
          'graduated', count(*) filter (where status = 'graduated'),
          'closed', count(*) filter (where status = 'closed'), 'balance', coalesce(sum(balance), 0),
          'median', coalesce(percentile_disc(0.5) within group (order by balance), 0), 'max', coalesce(max(balance), 0))
        from holders),
      'distribution', (select jsonb_agg(jsonb_build_object('label', b.label, 'count', (
          select count(*) from holders a where a.balance >= b.lo and (b.hi is null or a.balance <= b.hi))) order by b.lo)
        from (values ('0', 0, 0), ('1–19', 1, 19), ('20–49', 20, 49), ('50–99', 50, 99), ('100–199', 100, 199),
          ('200 以上', 200, null)) b(label, lo, hi)),
      'products', (select coalesce(jsonb_agg(to_jsonb(x) order by x.qty desc, x.name), '[]') from (
        select p.name, sum(i.qty) as qty, sum(i.qty * i.unit_price) as amount,
          coalesce(sum(i.qty * i.unit_price) filter (where l.payment = 'account'), 0) as account,
          coalesce(sum(i.qty * i.unit_price) filter (where l.payment = 'cash'), 0) as cash,
          case when bool_and(p.cost is not null) then sum(i.qty * p.cost) end as cost
        from live l join public.txn_items i on i.txn_id = l.id join public.products p on p.id = i.product_id
        where l.type = 'purchase' group by p.id, p.name) x),
      'stock', (select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]') from (
        select p.name, p.price, p.cost,
          p.stock - coalesce(sum(m.qty_delta) filter (where m.created_at >= v_start), 0) as opening,
          coalesce(sum(m.qty_delta) filter (where m.kind = 'stock_in' and m.created_at >= v_start and m.created_at < v_end), 0) as stock_in,
          coalesce(-sum(m.qty_delta) filter (where m.kind = 'stock_out' and m.created_at >= v_start and m.created_at < v_end), 0) as stock_out,
          coalesce(-sum(m.qty_delta) filter (where m.kind in ('sale', 'reversal') and m.created_at >= v_start and m.created_at < v_end), 0) as sold,
          p.stock - coalesce(sum(m.qty_delta) filter (where m.created_at >= v_end), 0) as closing
        from public.products p left join public.stock_movements m on m.product_id = p.id group by p.id) x),
      'issues', jsonb_build_object(
        'batches', (select coalesce(jsonb_agg(jsonb_build_object('batch_no', m.batch_no, 'issued_on', m.on_date,
            'total', m.total + coalesce(c.total, 0), 'purpose', m.reason, 'approver', m.approver_name,
            'denominations', m.denominations, 'corrections', coalesce(c.denominations, '[]')) order by m.on_date, m.batch_no), '[]')
          from public.currency_moves m
          left join lateral (select sum(total) as total, jsonb_agg(denominations order by created_at, id) as denominations
            from public.currency_moves where corrects = m.id and on_date <= p_to) c on true
          where m.kind = 'issue' and m.on_date between p_from and p_to),
        'total', (v_paper ->> 'issued')::integer),
      'bank_cash', (v_paper ->> 'bank')::integer));
end
$$;
