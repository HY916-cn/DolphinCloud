-- 手动补录与更正 (PHASE-2.md §9.3–9.4, §10.9, §10.11, §14, §15): when the counter could not record a business (a system
-- failure, say), the bank admin enters it afterwards, dated when it happened: a 存款、取款、兑换 or 调账 (adjust). 编辑
-- one of these is a reversal of it and a corrected entry, both dated as it was, the entry pointing at the original
-- (corrects). The 活期利息 run_daily has accrued since then is worked out again: each day's difference waits in
-- interest_adjustments for the next 结息, the weeks already paid as well. The weekly 信用分 and the anchors stay as they
-- were. A 补录 belongs to no teller's duty: its cash counts in the bank's cash (cash_delta) and in no 下班 cash table.

-- 补录: when it was entered, the transaction itself dated when it happened (created_at) and its operator_id who entered
-- it; null for a transaction recorded as it happened.
alter table public.txns add column entered_at timestamptz;
-- 更正自: the original a corrected entry replaces; the original's reversal has reversal_of as usual.
alter table public.txns add column corrects uuid unique references public.txns(id);

create table public.interest_adjustments (     -- 活期利息更正
  student_no  text not null,
  day         date not null,                  -- 计息日
  txn_id      uuid not null references public.txns(id), -- 引起更正的补录流水
  balance     integer not null,               -- 更正后当天结束时的活期余额
  centi       integer not null,               -- 差额，单位 0.01 HTB，可为负
  settled_txn uuid references public.txns(id), -- 结息流水
  primary key (student_no, day, txn_id),
  foreign key (student_no, day) references public.interest_accruals (student_no, day)
);
create index on public.interest_adjustments (student_no) where settled_txn is null;
alter table public.interest_adjustments enable row level security;
grant select on public.interest_adjustments to authenticated;
-- As interest_accruals: a student their own, the accountant, president and bank admin everyone's.
create policy read on public.interest_adjustments for select to authenticated using (
  student_no = (select app_private.my_student_no())
  or (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));

-- The account a 补录 is for, locked: any account but a closed one (冻结、毕业 too), never the admin's own or their 工资账户.
create function app_private.manual_account(p_student_no text, p_me uuid) returns public.accounts
language plpgsql security definer set search_path = '' as $$
declare
  v_student public.students;
  v_account public.accounts;
begin
  select * into v_student from public.students where student_no = p_student_no;
  if not found then
    perform app_private.fail('STUDENT_NOT_FOUND');
  end if;
  if v_student.status = 'closed' then
    perform app_private.fail('STUDENT_INACTIVE', '{"status":"closed"}');
  end if;
  if v_student.user_id = p_me or exists (select 1 from public.staff_payroll where user_id = p_me and account = p_student_no) then
    perform app_private.fail('SELF_SERVICE_FORBIDDEN');
  end if;
  select * into v_account from public.accounts where student_no = p_student_no for update;
  return v_account;
end
$$;

-- 原始时间 (§10.11): not after now, not before the start of the latest term begun by today (in the holidays the one just
-- over; once that one is 结转, the day after it ended), nor before the student's account was opened.
create function app_private.manual_check_at(p_student_no text, p_at timestamptz) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_term public.terms;
  v_from timestamptz;
begin
  if p_at is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"occurred_at"}');
  end if;
  select * into v_term from public.terms where starts_on <= app_private.cn_date(now()) order by starts_on desc limit 1;
  if not found then
    perform app_private.fail('NO_TERM');
  end if;
  v_from := greatest(
    (case when v_term.closed_at is null then v_term.starts_on else v_term.ends_on + 1 end)::timestamp at time zone 'Asia/Shanghai',
    (select opened_at from public.students where student_no = p_student_no));
  if p_at < v_from or p_at > now() then
    perform app_private.fail('OCCURRED_OUT_OF_RANGE', jsonb_build_object('from', v_from, 'to', now()));
  end if;
end
$$;

-- Writes one 补录 dated p_at, entered now by p_me: a 存款 of the notes p_denominations; a 取款 of p_amount (the notes
-- paid, p_denominations, or the counter's usual change); a 兑换 of p_items at today's prices paid from the account or in
-- cash (the notes received, p_denominations, and the change); a 调账 of p_amount, plus or minus. No 取款 limits, and the
-- products need not be listed any more. The caller has locked the account and checked who and when; 活期 now must
-- stay 0 or more.
create function app_private.manual_post(p_id uuid, p_student_no text, p_type text, p_amount integer, p_payment text,
  p_denominations jsonb, p_items jsonb, p_at timestamptz, p_reason text, p_corrects uuid, p_me uuid) returns public.txns
language plpgsql security definer set search_path = '' as $$
declare
  v_account public.accounts;
  v_txn public.txns;
  v_amount integer;
  v_delta integer;
  v_cash integer := 0;
  v_notes jsonb;
  v_change jsonb;
  v_ids uuid[];
  v_qtys integer[];
  v_item record;
begin
  if p_type is null or p_type not in ('deposit', 'withdraw', 'purchase', 'adjust') then
    perform app_private.fail('INVALID_INPUT', '{"field":"type"}');
  end if;
  if p_type = 'deposit' then
    v_amount := app_private.cash_total(p_denominations);
    if v_amount <= 0 then
      perform app_private.fail('INVALID_AMOUNT');
    end if;
    v_delta := v_amount;
    v_cash := v_amount;
    v_notes := p_denominations;
  elsif p_type = 'withdraw' then
    if p_amount is null or p_amount <= 0 or p_denominations is not null and app_private.cash_total(p_denominations) <> p_amount then
      perform app_private.fail('INVALID_AMOUNT');
    end if;
    v_amount := p_amount;
    v_delta := -p_amount;
    v_cash := -p_amount;
    v_notes := coalesce(p_denominations, app_private.make_change(p_amount));
  elsif p_type = 'adjust' then
    if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 then
      perform app_private.fail('INVALID_AMOUNT');
    end if;
    v_amount := abs(p_amount);
    v_delta := p_amount;
  else
    if p_payment is null or p_payment not in ('account', 'cash') then
      perform app_private.fail('INVALID_INPUT', '{"field":"payment"}');
    end if;
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 or exists (
         select 1 from jsonb_array_elements(p_items) e
         where coalesce(e ->> 'qty', '') !~ '^[1-9][0-9]{0,3}$'
            or coalesce(e ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      perform app_private.fail('INVALID_INPUT', '{"field":"items"}');
    end if;
    select array_agg(product_id order by product_id), array_agg(qty order by product_id) into v_ids, v_qtys
    from (select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'qty')::integer)::integer as qty
          from jsonb_array_elements(p_items) e group by 1) s;
    perform 1 from public.products where id = any(v_ids) order by id for update;
    v_amount := 0;
    for v_item in
      select i.product_id, i.qty, p.id, p.name, p.price, p.stock
      from unnest(v_ids, v_qtys) i(product_id, qty) left join public.products p on p.id = i.product_id
      order by i.product_id
    loop
      if v_item.id is null then
        perform app_private.fail('PRODUCT_NOT_FOUND', jsonb_build_object('product_id', v_item.product_id));
      end if;
      if v_item.stock < v_item.qty then
        perform app_private.fail('OUT_OF_STOCK',
          jsonb_build_object('product_id', v_item.product_id, 'name', v_item.name, 'stock', v_item.stock));
      end if;
      v_amount := v_amount + v_item.price * v_item.qty;
    end loop;
    if p_payment = 'account' then
      v_delta := -v_amount;
    else
      v_delta := 0;
      v_cash := app_private.cash_total(p_denominations);
      if v_cash < v_amount then
        perform app_private.fail('CASH_NOT_ENOUGH', jsonb_build_object('due', v_amount, 'received', v_cash));
      end if;
      v_notes := p_denominations;
      v_change := app_private.make_change(v_cash - v_amount);
      v_cash := v_amount;
    end if;
  end if;

  select * into v_account from public.accounts where student_no = p_student_no;
  if v_account.balance + v_delta < 0 then
    perform app_private.fail('INSUFFICIENT_BALANCE',
      jsonb_build_object('balance', v_account.balance, 'short', -(v_account.balance + v_delta)));
  end if;
  update public.accounts set balance = balance + v_delta,
    total_in = total_in + case when p_type = 'deposit' then v_amount else 0 end,
    total_out = total_out + case when p_type = 'withdraw' then v_amount else 0 end,
    total_spent = total_spent + case when p_type = 'purchase' and p_payment = 'account' then v_amount else 0 end,
    updated_at = now()
  where student_no = p_student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, payment, denominations,
    change_given, reason, operator_id, device_id, created_at, entered_at, corrects)
  values (p_id, p_type::public.txn_type, p_student_no, v_amount, v_delta, v_account.balance, v_cash,
    case when p_type = 'purchase' then p_payment end, v_notes, v_change, p_reason, p_me,
    app_private.request_header('x-device-id'), p_at, now(), p_corrects)
  returning * into v_txn;
  if p_type = 'purchase' then
    insert into public.txn_items (txn_id, product_id, name, unit_price, qty)
    select v_txn.id, p.id, p.name, p.price, i.qty from unnest(v_ids, v_qtys) i(product_id, qty) join public.products p on p.id = i.product_id;
    update public.products p set stock = p.stock - i.qty, updated_at = now()
    from unnest(v_ids, v_qtys) i(product_id, qty) where p.id = i.product_id;
    insert into public.stock_movements (product_id, kind, qty_delta, txn_id, operator_id, created_at)
    select i.product_id, 'sale', -i.qty, v_txn.id, p_me, p_at from unnest(v_ids, v_qtys) i(product_id, qty);
  end if;
  return v_txn;
end
$$;

-- 更正 takes the original out with a reversal dated as it was, entered now: what it moved in 活期, cash and stock goes
-- back, as reverse_txn does for these four types.
create function app_private.manual_reverse(p_orig public.txns, p_reason text, p_me uuid) returns public.txns
language plpgsql security definer set search_path = '' as $$
declare
  v_account public.accounts;
  v_txn public.txns;
begin
  select * into v_account from public.accounts where student_no = p_orig.student_no;
  if v_account.balance < p_orig.balance_delta then
    perform app_private.fail('REVERSAL_INSUFFICIENT_BALANCE', jsonb_build_object('balance', v_account.balance, 'amount', p_orig.amount));
  end if;
  update public.accounts set balance = balance - p_orig.balance_delta,
    total_in = total_in - case when p_orig.type = 'deposit' then p_orig.amount else 0 end,
    total_out = total_out - case when p_orig.type = 'withdraw' then p_orig.amount else 0 end,
    total_spent = total_spent - case when p_orig.type = 'purchase' and p_orig.payment = 'account' then p_orig.amount else 0 end,
    updated_at = now()
  where student_no = p_orig.student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, payment, reversal_of, reason,
    operator_id, device_id, created_at, entered_at)
  values (gen_random_uuid(), 'reversal', p_orig.student_no, p_orig.amount, -p_orig.balance_delta, v_account.balance,
    -p_orig.cash_delta, p_orig.payment, p_orig.id, p_reason, p_me, app_private.request_header('x-device-id'), p_orig.created_at, now())
  returning * into v_txn;
  update public.txns set status = 'reversed' where id = p_orig.id;
  if p_orig.type = 'purchase' then
    perform 1 from public.products where id in (select product_id from public.txn_items where txn_id = p_orig.id) order by id for update;
    update public.products p set stock = p.stock + i.qty, updated_at = now()
    from public.txn_items i where i.txn_id = p_orig.id and p.id = i.product_id;
    insert into public.stock_movements (product_id, kind, qty_delta, txn_id, operator_id, created_at)
    select product_id, 'reversal', qty, v_txn.id, p_me, p_orig.created_at from public.txn_items where txn_id = p_orig.id;
  end if;
  return v_txn;
end
$$;

-- 历史余额 (§10.11): with the 补录 (p_delta: what it, and an original's reversal, move at p_at), 活期 never went below 0
-- from p_at on, taking each moment's transactions together in the order they are dated.
create function app_private.manual_check_history(p_student_no text, p_at timestamptz, p_delta integer) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_low record;
begin
  select x.created_at, x.run into v_low from (
    select t.created_at, sum(t.balance_delta) over (order by t.created_at) as run from public.txns t where t.student_no = p_student_no) x
  where x.created_at >= p_at order by x.run, x.created_at limit 1;
  if v_low.run < 0 then
    perform app_private.fail('INSUFFICIENT_BALANCE',
      jsonb_build_object('balance', v_low.run - p_delta, 'short', -v_low.run, 'at', v_low.created_at));
  end if;
end
$$;

-- 利息更正 (§9.3, §10.11): every day from p_from that run_daily has accrued for the student, whose 活期 at its end is no
-- longer what its interest was worked out on, gets the difference between the interest on 活期 at its end now, at the
-- day's rate (to 0.01 HTB, less dropped, as accrue_interest), and what the day has had (its accrual and earlier
-- corrections). The days not accrued yet are left to run_daily. p_txn is the 补录 that changed it. Returns the total
-- difference (0.01 HTB).
create function app_private.correct_interest(p_student_no text, p_from date, p_txn uuid) returns integer
language sql security definer set search_path = '' as $$
  with d as (
    select a.day, b.balance, floor(b.balance * a.rate / 7)::integer - a.centi
      - coalesce((select sum(j.centi) from public.interest_adjustments j where j.student_no = a.student_no and j.day = a.day), 0)::integer
        as centi
    from public.interest_accruals a, lateral (select app_private.balance_on(a.student_no, a.day) as balance) b
    where a.student_no = p_student_no and a.day >= p_from
  ), ins as (
    insert into public.interest_adjustments (student_no, day, txn_id, balance, centi)
    select p_student_no, day, p_txn, balance, centi from d where centi <> 0
    returning centi
  )
  select coalesce(sum(centi), 0)::integer from ins
$$;

-- A 补录's result: the transaction's (P1 §6.2) with whom it is for, why, when it was entered, what it corrects, and the
-- interest corrected for it, by student (days changed, the difference in 0.01 HTB).
create function app_private.manual_result(p_txn public.txns) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.txn_result(p_txn) || jsonb_build_object('student_no', p_txn.student_no, 'reason', p_txn.reason,
    'entered_at', p_txn.entered_at, 'corrects', p_txn.corrects,
    'interest', coalesce((select jsonb_agg(jsonb_build_object('student_no', student_no, 'days', n, 'centi', c) order by student_no)
      from (select student_no, count(*) as n, sum(centi) as c from public.interest_adjustments where txn_id = p_txn.id group by student_no) x), '[]'))
$$;

-- An 更正's result from its corrected entry: the reversal of the original and the entry.
create function app_private.correct_result(p_txn public.txns) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('reversal', app_private.txn_result(r) || jsonb_build_object('student_no', r.student_no,
      'reversal_of', r.reversal_of, 'reason', r.reason, 'entered_at', r.entered_at),
    'txn', app_private.manual_result(p_txn))
  from public.txns r where r.reversal_of = p_txn.corrects
$$;

-- 补录 (§10.11) by the bank admin: p_type deposit (p_denominations received), withdraw (p_amount; p_denominations paid,
-- or the counter's usual change), purchase (p_items, p_payment account or cash; for cash p_denominations received) or
-- adjust (p_amount, plus or minus), dated p_occurred_at; why (p_reason) is required. p_id is the transaction's id: sent
-- again, it returns the same result. 活期 may not have gone below 0 at any time since; the interest accrued since is
-- corrected. The jobs' lock keeps it from interleaving with run_daily.
create function public.manual_entry(p_id uuid, p_student_no text, p_type text, p_occurred_at timestamptz, p_reason text,
  p_amount integer default null, p_payment text default null, p_denominations jsonb default null, p_items jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_reason text := nullif(trim(p_reason), '');
  v_txn public.txns;
begin
  perform app_private.forbid_president();
  if v_reason is null or char_length(v_reason) > 100 then
    perform app_private.fail('INVALID_INPUT', '{"field":"reason"}');
  end if;
  perform 1 from public.job_runs where job = 'daily' for update;
  select * into v_txn from public.txns where id = p_id;
  if found then
    return app_private.manual_result(v_txn);
  end if;
  perform app_private.manual_account(p_student_no, v_me);
  perform app_private.manual_check_at(p_student_no, p_occurred_at);
  v_txn := app_private.manual_post(p_id, p_student_no, p_type, p_amount, p_payment, p_denominations, p_items, p_occurred_at,
    '补录：' || v_reason, null, v_me);
  perform app_private.manual_check_history(p_student_no, p_occurred_at, v_txn.balance_delta);
  perform app_private.correct_interest(p_student_no, app_private.cn_date(p_occurred_at), v_txn.id);
  -- M13 风险提醒：每笔补录记一条提醒（对象 txns:<id>）
  perform app_private.log('txn.manual', 'txns:' || v_txn.id, null, app_private.manual_result(v_txn));
  return app_private.manual_result(v_txn);
end
$$;

-- 编辑 (§10.11) by the bank admin: a 存款、取款、兑换 or 调账 still normal, of any day since the range of manual_check_at,
-- is reversed and entered again as p_new says ({"student_no","type","amount","payment","denominations","items"} as for
-- manual_entry; the student and type default to the original's), both dated as the original and entered now; p_reason
-- is one of reverse_txn's. p_id is the corrected entry's id: sent again, it returns the same result. Whichever of the
-- two adds to 活期 goes first, so 活期 now does not dip below 0 between them.
create function public.correct_txn(p_id uuid, p_original_id uuid, p_new jsonb, p_reason text) returns jsonb
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

  if v_orig.balance_delta < 0 or v_no <> v_orig.student_no then
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
revoke execute on function public.manual_entry(uuid, text, text, timestamptz, text, integer, text, jsonb, jsonb),
  public.correct_txn(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.manual_entry(uuid, text, text, timestamptz, text, integer, text, jsonb, jsonb),
  public.correct_txn(uuid, uuid, jsonb, text) to authenticated;

-- settle_interest as in 20261115000100_interest.sql, with the corrections not yet paid (§10.11), which may be below 0:
-- the 结息 takes the account's accruals, corrections and carry together, and says what the corrections came to:
-- 「11月10日至11月16日活期利息，含更正 +0.15 HTB」, or with corrections alone「活期利息更正 +1.20 HTB」.
create or replace function app_private.settle_interest(p_at timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_system uuid := app_private.system_user();
  v_account public.accounts;
  v_txn public.txns;
  v_n integer := 0;
  v_fixed text;
  r record;
begin
  for r in
    select a.student_no, a.interest_carry + coalesce(i.centi, 0) + coalesce(j.centi, 0) as total, i.first, i.last,
      coalesce(j.centi, 0) as fixed
    from public.accounts a join public.students s using (student_no)
      left join (select student_no, sum(centi) as centi, min(day) as first, max(day) as last
                 from public.interest_accruals where settled_txn is null group by student_no) i using (student_no)
      left join (select student_no, sum(centi) as centi from public.interest_adjustments where settled_txn is null group by student_no) j
        using (student_no)
    where s.status <> 'closed' and (i.student_no is not null or j.student_no is not null)
      and a.interest_carry + coalesce(i.centi, 0) + coalesce(j.centi, 0) >= 100
    order by a.student_no
  loop
    update public.accounts set balance = balance + r.total / 100, interest_carry = r.total % 100, updated_at = now()
    where student_no = r.student_no returning * into v_account;
    v_fixed := case when r.fixed > 0 then '+' else '−' end || to_char(abs(r.fixed) / 100.0, 'FM999999990.00') || ' HTB';
    insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, created_at)
    values (gen_random_uuid(), 'interest', r.student_no, r.total / 100, r.total / 100, v_account.balance,
      case when r.first is null then '活期利息更正 ' || v_fixed
        else case when r.first = r.last then to_char(r.first, 'FMMM月FMDD日') else to_char(r.first, 'FMMM月FMDD日') || '至' || to_char(r.last, 'FMMM月FMDD日') end
          || '活期利息' || case when r.fixed <> 0 then '，含更正 ' || v_fixed else '' end end,
      v_system, p_at)
    returning * into v_txn;
    update public.interest_accruals set settled_txn = v_txn.id where student_no = r.student_no and settled_txn is null;
    update public.interest_adjustments set settled_txn = v_txn.id where student_no = r.student_no and settled_txn is null;
    v_n := v_n + 1;
  end loop;
  -- M14 货币监控：interest 流水计为电子币新增（§9.6）
  return v_n;
end
$$;

-- pending_interest as in 20261115000100_interest.sql, with the corrections not yet paid.
create or replace function app_private.pending_interest(p_student_no text) returns integer
language sql stable security definer set search_path = '' as $$
  select a.interest_carry
    + coalesce((select sum(centi) from public.interest_accruals i where i.student_no = a.student_no and i.settled_txn is null), 0)::integer
    + coalesce((select sum(centi) from public.interest_adjustments j where j.student_no = a.student_no and j.settled_txn is null), 0)::integer
  from public.accounts a where a.student_no = p_student_no
$$;

-- reverse_txn as in 20261120000200_wealth.sql, with the 调账 (adjust) among what the president and bank admin reverse.
create or replace function public.reverse_txn(p_id uuid, p_original_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller', 'teacher');
  v_teacher boolean := app_private.has_role('teacher');
  v_orig public.txns;
  v_account public.accounts;
  v_txn public.txns;
  v_dep public.term_deposits;
  v_loan public.loans;
  v_hold public.wealth_holdings;
  v_pay public.loan_payments;
  v_amount integer;
  v_carry integer;
begin
  if p_reason is null or not (p_reason in ('金额录错', '学号录错', '业务选错') or p_reason ~ '^其他[：:]\s*\S') then
    perform app_private.fail('INVALID_INPUT', '{"field":"reason"}');
  end if;
  select * into v_orig from public.txns where id = p_original_id;
  if not found then
    perform app_private.fail('TXN_NOT_FOUND');
  end if;
  select * into v_account from public.accounts where student_no = v_orig.student_no for update;
  select * into v_txn from public.txns where id = p_id;
  if found then
    return app_private.txn_result(v_txn);
  end if;
  select * into v_orig from public.txns where id = p_original_id for update;
  select * into v_dep from public.term_deposits where id = v_orig.term_id for update;
  select * into v_loan from public.loans where id = v_orig.loan_id for update;
  select * into v_hold from public.wealth_holdings where id = v_orig.wealth_id for update;
  select * into v_pay from public.loan_payments where txn_id = v_orig.id;

  if v_orig.status <> 'normal'
     or not (v_orig.type in ('deposit', 'withdraw', 'purchase', 'term_open', 'loan', 'repay', 'wealth_buy')
             or (v_teacher and v_orig.type in ('opening', 'term_close', 'wealth_close', 'adjust')))
     or not (v_teacher or (v_orig.operator_id = v_me and app_private.cn_date(v_orig.created_at) = app_private.cn_date(now())))
     or v_orig.type = 'term_open' and v_dep.status <> 'open'
     or v_orig.type = 'term_close' and (v_dep.status <> 'early' or v_dep.matures_on < app_private.cn_date(now()))
     or v_orig.type = 'wealth_buy' and (v_hold.status <> 'open' or v_hold.valued_to > v_hold.starts_on)
     or v_orig.type = 'wealth_close' and (v_hold.status <> 'redeemed' or v_hold.matures_on < app_private.cn_date(now()))
     or v_orig.type = 'loan' and (v_loan.status <> 'active'
       or exists (select 1 from public.txns where loan_id = v_loan.id and type = 'repay' and status = 'normal'))
     or v_orig.type = 'repay' and (exists (select 1 from public.txns where loan_id = v_loan.id and type = 'repay' and status = 'normal' and seq > v_orig.seq)
       or v_loan.status = 'closed' and exists (select 1 from public.loans where student_no = v_loan.student_no and status in ('active', 'overdue'))) then
    perform app_private.fail('REVERSAL_NOT_ALLOWED');
  end if;
  -- What the reversal takes out of 活期 (negative: puts back), and the 零头 left.
  v_amount := v_orig.balance_delta;
  v_carry := v_account.interest_carry;
  if v_orig.type = 'term_close' then
    -- The interest paid comes back: its whole HTB were in this transaction, its 零头 in interest_carry; a carry since
    -- spent or grown past 1 HTB moves whole HTB between the two.
    v_carry := v_carry - v_dep.interest_centi + 100 * (v_orig.amount - v_dep.principal);
    v_amount := v_amount - floor(v_carry / 100.0)::integer;
    v_carry := v_carry - 100 * floor(v_carry / 100.0)::integer;
  elsif v_orig.type = 'wealth_close' then
    -- The value paid comes back the same way: its whole HTB here, the rest out of interest_carry.
    v_carry := v_carry - v_hold.value_centi + 100 * v_orig.amount;
    v_amount := v_amount - floor(v_carry / 100.0)::integer;
    v_carry := v_carry - 100 * floor(v_carry / 100.0)::integer;
  end if;
  if v_account.balance < v_amount then
    perform app_private.fail('REVERSAL_INSUFFICIENT_BALANCE', jsonb_build_object('balance', v_account.balance,
      'amount', case when v_orig.type in ('term_close', 'wealth_close') then v_amount else v_orig.amount end));
  end if;

  update public.accounts set balance = balance - v_amount,
    total_in = total_in - case when v_orig.type in ('deposit', 'opening') then v_orig.amount else 0 end,
    total_out = total_out - case when v_orig.type = 'withdraw' then v_orig.amount else 0 end,
    total_spent = total_spent - case when v_orig.type = 'purchase' and v_orig.payment = 'account' then v_orig.amount else 0 end,
    term_total = term_total + case v_orig.type when 'term_open' then -v_dep.principal when 'term_close' then v_dep.principal else 0 end,
    wealth_total = wealth_total + case v_orig.type when 'wealth_buy' then -v_hold.principal when 'wealth_close' then v_hold.principal else 0 end,
    interest_carry = v_carry,
    updated_at = now()
  where student_no = v_orig.student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, payment,
    reversal_of, reason, operator_id, device_id, term_id, loan_id, wealth_id)
  values (p_id, 'reversal', v_orig.student_no, case when v_orig.type = 'term_close' then v_amount when v_orig.type = 'wealth_close' then abs(v_amount)
    else v_orig.amount end,
    -v_amount, v_account.balance, -v_orig.cash_delta, v_orig.payment, v_orig.id, p_reason, v_me,
    app_private.request_header('x-device-id'), v_orig.term_id, v_orig.loan_id, v_orig.wealth_id)
  returning * into v_txn;
  update public.txns set status = 'reversed' where id = v_orig.id;

  if v_orig.type = 'purchase' then
    perform 1 from public.products where id in (select product_id from public.txn_items where txn_id = v_orig.id)
    order by id for update;
    update public.products p set stock = p.stock + i.qty, updated_at = now()
    from public.txn_items i where i.txn_id = v_orig.id and p.id = i.product_id;
    insert into public.stock_movements (product_id, kind, qty_delta, txn_id, operator_id)
    select product_id, 'reversal', qty, v_txn.id, v_me from public.txn_items where txn_id = v_orig.id;
  elsif v_orig.type = 'term_open' then
    update public.term_deposits set status = 'reversed' where id = v_dep.id;
  elsif v_orig.type = 'term_close' then
    update public.term_deposits set status = 'open', close_txn = null, interest_centi = null where id = v_dep.id;
  elsif v_orig.type = 'wealth_buy' then
    update public.wealth_holdings set status = 'reversed' where id = v_hold.id;
  elsif v_orig.type = 'wealth_close' then
    update public.wealth_holdings set status = 'open', close_txn = null where id = v_hold.id;
  elsif v_orig.type = 'loan' then
    -- 作废: no interest, no points
    update public.loans set status = 'reversed', remaining = 0, interest_centi = 0 where id = v_loan.id;
  elsif v_orig.type = 'repay' then
    update public.loan_periods p set principal = (e ->> 'principal')::integer, paid = (e ->> 'paid')::integer
    from jsonb_array_elements(v_pay.before -> 'periods') e where p.loan_id = v_loan.id and p.seq = (e ->> 'seq')::integer;
    update public.loans set remaining = remaining + v_pay.principal,
      interest_centi = case when status = 'closed' then (v_pay.before ->> 'interest_centi')::integer else interest_centi + 100 * v_pay.interest end,
      closed_on = null,
      status = case when exists (select 1 from public.loan_periods where loan_id = v_loan.id and paid < principal and overdue_at is not null)
        then 'overdue' else 'active' end
    where id = v_loan.id;
    perform app_private.mark_overdue(v_loan.id, app_private.cn_date(now()) - 1, now());
  end if;

  perform app_private.log('txn.reverse', 'txns:' || v_orig.id, to_jsonb(v_orig), to_jsonb(v_txn));
  return app_private.txn_result(v_txn);
end
$$;

-- check_balances as in 20261120000200_wealth.sql, the interest corrections paid counted with the accruals paid (kind
-- interest).
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
    union all
    -- 利息累计与计息记录一致 (PHASE-2.md §14.1), 活期 and 定期
    select 'interest', a.student_no, (100 * (coalesce(p.paid, 0) + coalesce(tp.paid, 0) + coalesce(wp.paid, 0)) + a.interest_carry)::integer,
      coalesce(s.centi, 0) + coalesce(te.centi, 0) + coalesce(we.centi, 0)
    from public.accounts a
      left join (select student_no, sum(amount) as paid from public.txns where type = 'interest' group by student_no) p using (student_no)
      left join (select student_no, sum(centi) as centi from (
                   select student_no, centi from public.interest_accruals where settled_txn is not null
                   union all select student_no, centi from public.interest_adjustments where settled_txn is not null) x
                 group by student_no) s using (student_no)
      left join (select t.student_no, sum(case when t.type = 'term_close' then t.amount - d.principal else d.principal - t.amount end) as paid
                 from public.txns t join public.term_deposits d on d.id = t.term_id left join public.txns o on o.id = t.reversal_of
                 where t.type = 'term_close' or o.type = 'term_close' group by t.student_no) tp using (student_no)
      left join (select student_no, sum(interest_centi) as centi from public.term_deposits where status in ('matured', 'early')
                 group by student_no) te using (student_no)
      left join (select t.student_no, sum(case when t.type = 'wealth_close' then t.balance_delta - h.principal else h.principal + t.balance_delta end) as paid
                 from public.txns t join public.wealth_holdings h on h.id = t.wealth_id left join public.txns o on o.id = t.reversal_of
                 where t.type = 'wealth_close' or o.type = 'wealth_close' group by t.student_no) wp using (student_no)
      left join (select student_no, sum(value_centi - 100 * principal) as centi from public.wealth_holdings where status in ('matured', 'redeemed')
                 group by student_no) we using (student_no)
    where 100 * (coalesce(p.paid, 0) + coalesce(tp.paid, 0) + coalesce(wp.paid, 0)) + a.interest_carry
      <> coalesce(s.centi, 0) + coalesce(te.centi, 0) + coalesce(we.centi, 0)
    union all
    -- 定期本金合计与 term_deposits 一致 (§14.1)
    select 'term', a.student_no, a.term_total, coalesce(sum(d.principal) filter (where d.status = 'open'), 0)
    from public.accounts a left join public.term_deposits d using (student_no)
    group by a.student_no, a.term_total having a.term_total <> coalesce(sum(d.principal) filter (where d.status = 'open'), 0)
    union all
    -- 理财本金合计与 wealth_holdings 一致 (§14.1)
    select 'wealth', a.student_no, a.wealth_total, coalesce(sum(h.principal) filter (where h.status = 'open'), 0)
    from public.accounts a left join public.wealth_holdings h using (student_no)
    group by a.student_no, a.wealth_total having a.wealth_total <> coalesce(sum(h.principal) filter (where h.status = 'open'), 0)
    union all
    -- 贷款剩余本金与放款、还款流水一致 (§14.1)
    select 'loan', l.loan_no, l.remaining, coalesce(sum(case when t.type = 'loan' then t.amount else -p.principal end), 0)
    from public.loans l left join public.txns t on t.loan_id = l.id and t.type in ('loan', 'repay') and t.status = 'normal'
      left join public.loan_payments p on p.txn_id = t.id
    group by l.id, l.loan_no, l.remaining having l.remaining <> coalesce(sum(case when t.type = 'loan' then t.amount else -p.principal end), 0)
    union all
    select 'loan_plan', l.loan_no, l.remaining, sum(p.principal - p.paid)
    from public.loans l join public.loan_periods p on p.loan_id = l.id
    where l.status <> 'reversed'
    group by l.id, l.loan_no, l.remaining having l.remaining <> sum(p.principal - p.paid)
  ) r;
  if jsonb_array_length(v_rows) > 0 then
    perform app_private.log('check.mismatch', null, null, v_rows);
  end if;
  return query select * from jsonb_to_recordset(v_rows) as x(kind text, key text, recorded integer, expected bigint);
end
$$;

-- bank_report as in 20261116000100_term_deposits.sql: 期初、期末 are the sums of the transactions dated before them (a
-- 补录 is written after the ones dated later), and 调账 (adjust: count, net change) is listed.
create or replace function public.bank_report(p_from date, p_to date, p_division text default null, p_cohort integer default null,
  p_class_no integer default null, p_student_no text default null, p_time_from time default null, p_time_to time default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('accountant', 'teacher');
  v_start timestamptz := p_from::timestamp at time zone 'Asia/Shanghai';
  v_end timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Shanghai';
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    perform app_private.fail('INVALID_INPUT', '{"field":"period"}');
  end if;
  if p_time_from >= p_time_to then
    perform app_private.fail('INVALID_INPUT', '{"field":"time"}');
  end if;
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
          from t where type <> 'opening' and operator_id <> app_private.system_user() group by operator_id) x
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
        'batches', (select coalesce(jsonb_agg(jsonb_build_object('batch_no', batch_no, 'issued_on', issued_on, 'total', total,
            'purpose', purpose, 'approver', approver_name, 'denominations', denominations) order by issued_on, batch_no), '[]')
          from public.currency_issues where issued_on between p_from and p_to),
        'total', (select coalesce(sum(total), 0) from public.currency_issues where issued_on <= p_to))));
end
$$;

-- student_txns as in 20261105000300_student_txns_filter.sql, with entered_at (补录) and the 更正 both ways: corrects_no
-- (更正自) and corrected_no (已更正为).
create or replace function public.student_txns(p_student_no text, p_before bigint default null, p_limit integer default 10,
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
      t.created_at, p.display_name as operator, t.entered_at,
      (select o.txn_no from public.txns o where o.id = t.corrects) as corrects_no,
      (select n.txn_no from public.txns n where n.corrects = t.id) as corrected_no,
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
