-- 工资 (PHASE-1.md §6.9): the transaction that pays a teller's confirmed shifts into their student account. The enum
-- value is committed on its own, before the functions that write it.
alter type public.txn_type add value 'salary';
