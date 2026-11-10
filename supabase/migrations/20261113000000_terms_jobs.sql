-- 学期 and the scheduled jobs (PHASE-2.md §6, §13, §14.2). Interest, credit, the anchor rate, deposits and loans (M8–M11)
-- run only on days in a term; the jobs that run them are laid out here, with a marked place for each milestone's work.

create table public.terms (                   -- 学期
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  starts_on  date not null,
  ends_on    date not null check (ends_on >= starts_on),
  closed_at  timestamptz,                     -- 结转时间
  closed_by  uuid references public.profiles(id),
  exclude using gist (daterange(starts_on, ends_on, '[]') with &&)
);
create trigger audit after insert or update or delete on public.terms for each row execute function app_private.audit_row();
alter table public.terms enable row level security;
grant select on public.terms to authenticated;
-- Every signed-in login reads the terms: the student app and the counter tell the current term from them.
create policy read on public.terms for select to authenticated using (true);

create table public.job_runs (                -- 定时任务进度
  job      text primary key check (job in ('daily', 'weekly')),
  done_to  date not null,                     -- the last day done (weekly: the last Monday, or where it started)
  last_ok  timestamptz,
  last_err text                               -- the day that failed and why; cleared when that job next succeeds
);
-- Days before this version are not caught up: the jobs start from today.
insert into public.job_runs (job, done_to) values ('daily', app_private.cn_date(now()) - 1), ('weekly', app_private.cn_date(now()) - 1);
alter table public.job_runs enable row level security;
grant select on public.job_runs to authenticated;
-- The sysadmin's overview and the bank admin (and president) see whether a job failed.
create policy read on public.job_runs for select to authenticated using (
  (select app_private.has_role('sysadmin')) or (select app_private.has_role('teacher')));

-- The term the day (an Asia/Shanghai date) falls in; null in the holidays between terms.
create function app_private.current_term(p_day date) returns public.terms
language sql stable security definer set search_path = '' as $$
  select * from public.terms where p_day between starts_on and ends_on
$$;

-- For the functions that need a current term (定期, 贷款): the term of the day, or NO_TERM.
create function app_private.require_term(p_day date default app_private.cn_date(now())) returns public.terms
language plpgsql stable security definer set search_path = '' as $$
declare
  v_term public.terms := app_private.current_term(p_day);
begin
  if v_term.id is null then
    perform app_private.fail('NO_TERM');
  end if;
  return v_term;
end
$$;

-- 登记、修改学期 (§6.1), the bank admin alone. Days already past neither move into a term nor out of one: a term that has
-- started keeps its start, and an end date changes only while both the old and the new one are today or later. A new term
-- may start in the past (the term under way at 上线); the jobs do not go back over days they have done.
create function public.upsert_term(p_id uuid, p_name text, p_starts date, p_ends date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_today date := app_private.cn_date(now());
  v_name text := nullif(trim(p_name), '');
  v_old public.terms;
  v_term public.terms;
  v_overlap text;
begin
  perform app_private.forbid_president();
  if v_name is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"name"}');
  end if;
  if p_starts is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"starts_on"}');
  end if;
  if p_ends is null or p_ends < p_starts then
    perform app_private.fail('INVALID_INPUT', '{"field":"ends_on"}');
  end if;
  select * into v_old from public.terms where id = p_id for update;
  if v_old.closed_at is not null then
    perform app_private.fail('TERM_CLOSED');
  end if;
  if v_old.id is not null then
    if p_starts <> v_old.starts_on and (v_old.starts_on <= v_today or p_starts < v_today) then
      perform app_private.fail('INVALID_INPUT', '{"field":"starts_on"}');
    end if;
    if p_ends <> v_old.ends_on and (v_old.ends_on < v_today or p_ends < v_today) then
      perform app_private.fail('INVALID_INPUT', '{"field":"ends_on"}');
    end if;
  end if;
  if exists (select 1 from public.terms where name = v_name and id is distinct from p_id) then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"name"}');
  end if;
  select name into v_overlap from public.terms
  where id is distinct from p_id and daterange(starts_on, ends_on, '[]') && daterange(p_starts, p_ends, '[]')
  order by starts_on limit 1;
  if v_overlap is not null then
    perform app_private.fail('TERM_OVERLAP', jsonb_build_object('term', v_overlap));
  end if;

  if v_old.id is null then
    insert into public.terms (id, name, starts_on, ends_on) values (coalesce(p_id, gen_random_uuid()), v_name, p_starts, p_ends)
    returning * into v_term;
  else
    update public.terms set name = v_name, starts_on = p_starts, ends_on = p_ends where id = p_id returning * into v_term;
  end if;
  return to_jsonb(v_term);
end
$$;

-- What keeps a term from 结转 (§6.3), as a list of {"kind": ...}. M10 adds a branch for 未到期的定期 and M11 one for
-- 未结清的贷款. Until the daily job has done the term's last day, that day's maturities and repayments are still to come.
create function app_private.term_open_items(p_term public.terms) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(i), '[]') from (
    select jsonb_build_object('kind', 'job', 'job', job, 'done_to', done_to) as i
    from public.job_runs where job = 'daily' and done_to < p_term.ends_on
  ) x
$$;

-- 学期结转 (§6.3), the bank admin alone, after the term's last day. Balances and credit carry over as they are: no
-- transaction, only closed_at and a term.close entry.
create function public.close_term(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_term public.terms;
  v_items jsonb;
begin
  perform app_private.forbid_president();
  select * into v_term from public.terms where id = p_id for update;
  if v_term.id is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"term_id"}');
  end if;
  if v_term.closed_at is not null then
    perform app_private.fail('TERM_CLOSED');
  end if;
  if app_private.cn_date(now()) <= v_term.ends_on then
    perform app_private.fail('TERM_NOT_ENDED', jsonb_build_object('ends_on', v_term.ends_on));
  end if;
  v_items := app_private.term_open_items(v_term);
  if v_items <> '[]' then
    perform app_private.fail('TERM_OPEN_ITEMS', jsonb_build_object('items', v_items));
  end if;
  update public.terms set closed_at = now(), closed_by = v_me where id = p_id returning * into v_term;
  perform app_private.log('term.close', 'terms:' || p_id, null, to_jsonb(v_term));
  return to_jsonb(v_term);
end
$$;

grant execute on function public.upsert_term(uuid, text, date, date), public.close_term(uuid) to authenticated;

-- The daily job (§13) for p_day, the day after the last one done; a day already done is skipped, so running it again
-- changes nothing. Out of term (假期) the day is done with nothing to do. The work reads p_day, never now(), so a
-- catch-up after the server was down gives what running every day would have.
create function app_private.run_daily(p_day date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_done date;
  v_term public.terms := app_private.current_term(p_day);
begin
  select done_to into v_done from public.job_runs where job = 'daily' for update;
  if p_day <= v_done then
    return jsonb_build_object('job', 'daily', 'day', p_day, 'status', 'skipped');
  end if;
  if p_day <> v_done + 1 or p_day >= app_private.cn_date(now()) then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'day', 'next', v_done + 1));
  end if;
  if v_term.id is not null then
    null;
    -- In term, in this order (§13):
    -- M9  活期计息
    -- M11 贷款计息
    -- M10 到期的定期转回活期并付息
    -- M11 应还日到期的分期自动扣款或记逾期；逾期贷款自动扣款
    -- M9  p_day = v_term.ends_on 且不是周日时，结清最后不满一周的利息（学期后的周一在假期里，不结息）
  end if;
  update public.job_runs set done_to = p_day, last_ok = now(), last_err = null where job = 'daily';
  return jsonb_build_object('job', 'daily', 'day', p_day, 'status', case when v_term.id is null then 'holiday' else 'done' end,
    'term_id', v_term.id);
end
$$;

-- The weekly job (§13) for the Monday p_week, after the daily job for the Sunday before; skipped when already done.
-- Only Mondays in a term are worked; first marks the term's first Monday, which keeps the anchor from before the
-- holiday (§9.1).
create function app_private.run_weekly(p_week date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_done date;
  v_term public.terms := app_private.current_term(p_week);
  v_first boolean := v_term.starts_on > p_week - 7;
begin
  select done_to into v_done from public.job_runs where job = 'weekly' for update;
  if p_week <= v_done then
    return jsonb_build_object('job', 'weekly', 'day', p_week, 'status', 'skipped');
  end if;
  if extract(isodow from p_week) <> 1 or p_week > v_done + 7
     or (select done_to from public.job_runs where job = 'daily') < p_week - 1 then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'week'));
  end if;
  if v_term.id is not null then
    null;
    -- In term, in this order (§13):
    -- M9 活期结息（上周的利息）
    -- M8 信用分的每周加减分
    -- M9 计算并公布本周锚点；v_first 时不调整，沿用放假前的锚点
  end if;
  update public.job_runs set done_to = p_week, last_ok = now(), last_err = null where job = 'weekly';
  return jsonb_build_object('job', 'weekly', 'day', p_week, 'status', case when v_term.id is null then 'holiday' else 'done' end,
    'term_id', v_term.id, 'first', coalesce(v_first, false));
end
$$;

-- Catches up to p_today (today in Asia/Shanghai): each day from the one after the daily job's done_to, in time order. A
-- Monday's weekly job runs after the Sunday's daily job and before its own, as at 00:05 and 00:10 that Monday. The first
-- job that fails stops the run: what came before stays done, the failed job's work is undone, and the failure goes to
-- job_runs.last_err and the audit log (job.failed). Returns {"ran": [what each job did], "failed": null or the failure}.
-- dolphin-jobs and `dolphin jobs run` call it.
create function app_private.run_jobs(p_today date default app_private.cn_date(now())) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day date;
  v_job text;
  v_result jsonb;
  v_ran jsonb := '[]';
  v_failed jsonb;
begin
  if p_today > app_private.cn_date(now()) then
    perform app_private.fail('INVALID_INPUT', '{"field":"today"}');
  end if;
  for v_day in select generate_series(done_to + 1, p_today, interval '1 day')::date from public.job_runs where job = 'daily' loop
    foreach v_job in array array['weekly', 'daily'] loop
      continue when v_job = 'weekly' and extract(isodow from v_day) <> 1 or v_job = 'daily' and v_day = p_today;
      begin
        v_result := case v_job when 'daily' then app_private.run_daily(v_day) else app_private.run_weekly(v_day) end;
      exception when others then
        v_failed := jsonb_build_object('job', v_job, 'day', v_day, 'error', sqlerrm);
        update public.job_runs set last_err = v_day || ': ' || sqlerrm where job = v_job;
        perform app_private.log_system('job.failed', v_failed);
        return jsonb_build_object('ran', v_ran, 'failed', v_failed);
      end;
      if v_result ->> 'status' <> 'skipped' then
        v_ran := v_ran || v_result;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('ran', v_ran, 'failed', null);
end
$$;
