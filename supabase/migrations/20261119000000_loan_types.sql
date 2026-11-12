-- 贷款 (PHASE-2.md §10.3–10.9, §14.1): loan pays a loan out, repay pays it back. The enum values are committed on their
-- own, before the functions that write them.
alter type public.txn_type add value 'loan';
alter type public.txn_type add value 'repay';
