-- Access found by the role × function matrix (supabase/tests/20_rpc_matrix.sql).

-- pgcrypto lives in public, so PostgREST offered its functions to anyone, signed in or not (crypt with a high bcrypt
-- cost is minutes of CPU per call). Only the security definer functions use them, as their owner.
do $$
declare f regprocedure;
begin
  for f in select d.objid::regprocedure from pg_depend d join pg_extension e on e.oid = d.refobjid
           where e.extname = 'pgcrypto' and d.classid = 'pg_proc'::regclass and d.deptype = 'e' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- A disabled or closed student loses their own account, transactions and place at once, as a disabled staff login
-- loses its role (has_role).
create or replace function app_private.my_student_no() returns text
language sql stable security definer set search_path = '' as $$
  select s.student_no from public.students s join public.profiles p on p.id = s.user_id
  where s.user_id = auth.uid() and not p.must_change_password and not p.disabled
$$;

-- 存款排名 is the students' (PHASE-1.md §6.4): staff logins see no ranking of names and balances.
-- deposit_ranking, as in 20261108000000_ranking_neighbour.sql.
create or replace function public.deposit_ranking(p_division text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if app_private.my_student_no() is null then
    perform app_private.fail('FORBIDDEN', '{"roles":["student"]}', '42501');
  end if;
  return (
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
           from ranked r where r.student_no = app_private.my_student_no())));
end
$$;
