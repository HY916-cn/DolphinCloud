-- 手动补录与更正 (PHASE-2.md §10.11, §14.1): adjust is a 调账 the bank admin enters, plus or minus 活期, without cash. The
-- enum value is committed on its own, before the functions that write it.
alter type public.txn_type add value 'adjust';
