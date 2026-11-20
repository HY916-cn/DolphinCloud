-- bank_report at full school size (PHASE-1.md §10): jit off, and the parts read in a different way give what they gave
-- before: the 业务 count is the transactions app_private.is_business takes, the tellers leave out the system user, and
-- 发行 and 银行应有现金 are those of currency_state.
\ir helpers/setup.psql

select tests.staff('admin2', 'teacher') as admin \gset
select tests.staff('acc', 'accountant') as acc \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.student('s1', 500) as s1 \gset
select tests.student('s2', 50) as s2 \gset

select is((select proconfig @> '{jit=off}' from pg_proc where oid = 'public.bank_report'::regproc), true, 'bank_report runs without JIT');

-- Today: counter business, one of it reversed and its 冲正, a 结息 by the system user, a 调账, and an issue of notes.
select tests.call(:'teller', $$select deposit('00000000-0000-4000-8000-0000000043a1', 's1', '{"10":2}')$$) is not null;
select tests.call(:'teller', $$select deposit('00000000-0000-4000-8000-0000000043a2', 's2', '{"5":1}')$$) is not null;
select tests.call(:'teller', $$select withdraw('00000000-0000-4000-8000-0000000043a3', 's1', 7)$$) is not null;
select tests.call(:'teller', $$select reverse_txn('00000000-0000-4000-8000-0000000043a4', '00000000-0000-4000-8000-0000000043a2', '金额录错')$$) is not null;
update accounts set balance = balance + 3 where student_no = 's1';
insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id)
select gen_random_uuid(), 'interest', 's1', 3, 3, balance, app_private.system_user() from accounts where student_no = 's1';
update accounts set balance = balance + 4 where student_no = 's2';
insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id)
select gen_random_uuid(), 'adjust', 's2', 4, 4, balance, :'admin' from accounts where student_no = 's2';
select tests.call(:'admin', $$select record_currency('00000000-0000-4000-8000-0000000043b1', 'issue', '{"10":5,"1":20}',
  app_private.cn_date(now()), '奖励', 'B43', '王老师')$$) ->> 'kind';

select tests.call(:'acc', format('select bank_report(%1$L, %1$L)', app_private.cn_date(now()))) as rep \gset
select is((:'rep'::jsonb #>> '{operations,count}')::bigint,
  (select count(*) from txns t where app_private.cn_date(t.created_at) = app_private.cn_date(now()) and app_private.is_business(t)),
  '业务笔数: the transactions is_business takes');
select is((:'rep'::jsonb #>> '{operations,count}')::integer, 2, 'the deposit and the withdrawal still normal');
select is(array(select x ->> 'name' from jsonb_array_elements(:'rep'::jsonb -> 'tellers') x), '{t1,admin2}',
  'by operator: the teller and who entered the 调账, not the system user');
select is((:'rep'::jsonb #>> '{issues,total}')::integer,
  (app_private.currency_state(app_private.cn_date(now())) #>> '{paper,issued}')::integer, '发行 as currency_state');
select is((:'rep'::jsonb #>> '{issues,total}')::integer, 70, '70 HTB issued');
select is((:'rep'::jsonb ->> 'bank_cash')::integer,
  (app_private.currency_state(app_private.cn_date(now())) #>> '{paper,bank}')::integer, '银行应有现金 as currency_state');

select * from finish();
rollback;
