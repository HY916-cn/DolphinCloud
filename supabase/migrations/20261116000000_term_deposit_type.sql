-- 定期 (PHASE-2.md §10.2, §14.1): term_open moves 活期 into a 定期, term_close brings it back with its interest. The
-- enum values are committed on their own, before the functions that write them.
alter type public.txn_type add value 'term_open';
alter type public.txn_type add value 'term_close';
