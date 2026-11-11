-- 结息 (PHASE-2.md §9.4, §14.1): the weekly transaction that pays 活期利息 into a student's account. The enum value is
-- committed on its own, before the functions that write it.
alter type public.txn_type add value 'interest';
