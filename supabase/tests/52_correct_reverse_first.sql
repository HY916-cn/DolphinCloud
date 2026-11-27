-- 更正现金兑换 (PHASE-2.md §10.11): the original goes out first when it moved 活期 by 0, so a 兑换 paid in cash of the last
-- piece in stock is corrected (the note, the student) with none left.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('t1', 'teller') as t1 \gset
select tests.student('s1', 20) as s1 \gset
select tests.student('s2', 20) as s2 \gset
insert into products (id, name, price, listed, stock) values ('00000000-0000-4000-8000-000000000001', '书签', 6, true, 1);
insert into stock_movements (product_id, kind, qty_delta, operator_id) values ('00000000-0000-4000-8000-000000000001', 'stock_in', 1, :'teacher');

select tests.call(:'t1', $$select purchase('00000000-0000-4000-8000-0000000000a1', 's1',
  '[{"product_id":"00000000-0000-4000-8000-000000000001","qty":1}]', 'cash', '{"10":1}')$$);
select is((select stock from products), 0, 'the last piece sold in cash');

select is(tests.call(:'teacher', $$select correct_txn('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1',
    '{"payment":"cash","denominations":{"10":1},"items":[{"product_id":"00000000-0000-4000-8000-000000000001","qty":1}]}', '其他：补写备注')$$)
    #>> '{txn,type}', 'purchase', 'corrected as it was, with none in stock');
select is((select status::text from txns where id = '00000000-0000-4000-8000-0000000000a1'), 'reversed', 'the original reversed');
select is(tests.call(:'teacher', $$select correct_txn('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1',
    '{"student_no":"s2","payment":"cash","denominations":{"10":1},"items":[{"product_id":"00000000-0000-4000-8000-000000000001","qty":1}]}', '学号录错')$$)
    #>> '{txn,student_no}', 's2', 'and again to another student');
select is(array(select concat_ws(' ', t.student_no, t.type, t.status, t.cash_delta, t.corrects is not null) from txns t
    where t.type in ('purchase', 'reversal') order by t.seq),
  array['s1 purchase reversed 6 f', 's1 reversal normal -6 f', 's1 purchase reversed 6 t', 's1 reversal normal -6 f', 's2 purchase normal 6 t'],
  'each correction: the reversal first, then the entry');
select is((select stock from products), 0, 'still none in stock');
select is((select coalesce(sum(qty_delta), 0)::int from stock_movements), 0, 'every piece accounted for');
select is((select count(*)::int from app_private.check_balances()), 0, 'the self-check passes');

-- The stock still bounds a correction: 2 pieces with 1 given back are too many.
select is(tests.call(:'teacher', $$select correct_txn(gen_random_uuid(), '00000000-0000-4000-8000-0000000000c1',
    '{"payment":"cash","denominations":{"10":2},"items":[{"product_id":"00000000-0000-4000-8000-000000000001","qty":2}]}', '金额录错')$$) ->> 'error',
  'OUT_OF_STOCK', 'more than the stock given back is out of stock');
select is((select status::text from txns where id = '00000000-0000-4000-8000-0000000000c1'), 'normal', 'and leaves the original as it was');

select * from finish();
rollback;
