-- 理财 (PHASE-2.md §10.10, §14.1): wealth_buy moves 活期 into a 理财 holding, wealth_close brings its value back at
-- maturity or on redemption. The enum values are committed on their own, before the functions that write them.
alter type public.txn_type add value 'wealth_buy';
alter type public.txn_type add value 'wealth_close';
