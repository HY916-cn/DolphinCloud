-- 活期只随锚点 (PHASE-2.md §8.1, §9.1–9.3): the 活期 weekly rate is the week's anchor, whatever the score; 信用分 sets
-- the loan limit and the loan rate only. Each accrual keeps the rate it was made at (interest_accruals.rate), and
-- correct_interest works a 补录's difference out at that rate, so every day accrued before this migration keeps its
-- interest; every day accrued after it, a catch-up of an earlier day included, is at the anchor.

-- saving_rate as in 20261115000100_interest.sql: the anchor, to 4 decimals. The score stays in the signature for its
-- callers (rates, accrue_interest, early_interest, public_rates).
create or replace function app_private.saving_rate(p_anchor numeric, p_score integer) returns numeric
language sql stable security definer set search_path = '' as $$
  select round(p_anchor, 4)
$$;

-- credit_info as in 20261114000000_credit.sql, without the 储蓄系数.
create or replace function app_private.credit_info(p_student_no text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('student_no', student_no, 'score', score, 'loan_limit', app_private.credit_limit(score),
    'points_to_next', app_private.credit_next(score), 'loan_factor', app_private.loan_factor(score))
  from public.credit_scores where student_no = p_student_no
$$;

drop function app_private.saving_factor(integer);
drop function app_private.saving_factor_raw(integer);
