-- 存款排名 also tells how many students of the division rank, whether names are masked, the place and balance just
-- above the caller, how many have less, and the caller's row with the students right before and after, so the student
-- page can say how much more passes the next student up. Ties share a place: "above" is the nearest higher balance.
create or replace function public.deposit_ranking(p_division text default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  with division as (
    select coalesce(p_division, (select division from public.students where student_no = app_private.my_student_no())) as d
  ), ranked as (
    select s.student_no, a.balance,
           rank() over (order by a.balance desc) as place,
           row_number() over (order by a.balance desc, s.student_no) as n,
           jsonb_build_object('rank', rank() over (order by a.balance desc),
             'name', case when app_private.setting('ranking_anonymous') = 'true' then app_private.mask_name(s.name) else s.name end,
             'class_label', public.class_label(s), 'cohort', s.cohort, 'balance', a.balance,
             'me', s.student_no is not distinct from app_private.my_student_no()) as j
    from public.students s join public.accounts a on a.student_no = s.student_no
    where s.status = 'normal' and s.division = (select d from division)
  )
  select jsonb_build_object('division', (select d from division), 'total', (select count(*) from ranked),
    'anonymous', app_private.setting('ranking_anonymous') = 'true',
    'top', (select coalesce(jsonb_agg(j order by n), '[]') from ranked where n <= app_private.setting('ranking_size')::integer),
    'me', (select jsonb_build_object('rank', r.place, 'balance', r.balance,
              'above', (select jsonb_build_object('rank', a.place, 'balance', a.balance) from ranked a
                        where a.balance > r.balance order by a.balance limit 1),
              'behind', (select count(*) from ranked b where b.balance < r.balance),
              'near', (select jsonb_agg(x.j order by x.n) from ranked x where x.n between r.n - 1 and r.n + 1))
           from ranked r where r.student_no = app_private.my_student_no()))
$$;
