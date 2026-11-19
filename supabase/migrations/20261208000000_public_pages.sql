-- 公开页面 (PHASE-2.md §16.4): 利率看板, 大屏时间 and 文件传输, used without signing in. These are the functions anon
-- calls. Files go to the private Storage bucket transfers through URLs signed here with Storage's JWT secret, which
-- dolphin-migrate (and dolphin restore) keep in app_private.jwt_secret; the client IP is the X-Forwarded-For that Caddy
-- sets from the connection (PHASE-1.md §3.3).

-- Storage's JWT secret, one row, written by dolphin-migrate at every start; never in a backup.
create table app_private.jwt_secret (
  id     boolean primary key default true check (id),
  secret text not null check (secret <> '')
);

-- 大屏时间: the server's clock now, in milliseconds since 1970 (UTC).
create function public.server_time() returns bigint
language sql volatile security definer set search_path = '' as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint
$$;

-- 利率看板: this week's anchor, the 活期 and loan rates of 600, 750, 900, 1000 and credit_curve.min_score under it (600
-- alone while 信用分 is paused, as every student is at 600 then), term_rates, and the 理财 bases with the index's last
-- trading day. Nothing about anyone.
create function public.public_rates() returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select app_private.cn_date(now()) as today),
  a as (select app_private.anchor_on(today) as anchor,
          (select max(week_start) from public.rate_weeks where week_start <= today) as week_start from t),
  c as (select app_private.setting('credit_enabled') <> 'false' as enabled,
          (app_private.setting('credit_curve') ->> 'min_score')::integer as min_score),
  w as (select app_private.setting('wealth_params') as p)
  select jsonb_build_object('week_start', a.week_start, 'anchor', a.anchor,
    'credit_enabled', c.enabled, 'min_score', c.min_score,
    'scores', (select jsonb_agg(jsonb_build_object('score', s, 'current', app_private.saving_rate(a.anchor, s),
        'loan', app_private.loan_rate(a.anchor, s)) order by s)
      from (select distinct unnest(case when c.enabled then array[600, 750, 900, 1000, c.min_score] else array[600] end) s) x),
    'term', app_private.setting('term_rates'),
    'wealth', jsonb_build_object('name', w.p ->> 'name', 'base', w.p -> 'base',
      'day_base', (select jsonb_object_agg(k, app_private.day_base((w.p -> 'base' ->> k)::numeric)) from jsonb_object_keys(w.p -> 'base') k),
      'index', (select jsonb_build_object('day', d.day, 'change', d.change) from public.wealth_days d order by d.day desc limit 1)))
  from a, c, w
$$;

-- 文件传输 -------------------------------------------------------------------------------------------------------

create table public.transfers (               -- 一次发送
  id         uuid primary key default gen_random_uuid(),
  code       text unique check (code ~ '^[0-9]{4}$'), -- 取件码，全部传完后生成
  ip         text,                             -- 来源 IP
  total      bigint not null,                  -- 合计字节
  created_at timestamptz not null default now(),
  ready_at   timestamptz,                      -- 生成取件码的时间
  expires_at timestamptz,                      -- ready_at + 7 天
  check ((code is null) = (ready_at is null) and (ready_at is null) = (expires_at is null))
);
create index on public.transfers (ip, created_at);

create table public.transfer_files (
  transfer_id uuid not null references public.transfers(id) on delete cascade,
  seq         smallint not null check (seq between 1 and 20), -- Storage 里的对象为 transfers/<transfer_id>/<seq>
  name        text not null check (length(name) between 1 and 255),
  size        bigint not null check (size between 0 and 104857600),
  primary key (transfer_id, seq)
);

create table public.transfer_misses (         -- 输错取件码
  ip text,
  at timestamptz not null default now()
);
create index on public.transfer_misses (ip, at desc);

-- Rows of anonymous senders carry their IP, which goes with the transfer (§16.4): the audit log gets the bank admin's
-- deletions (transfer.delete, with the reason) and the daily clean-up's counts (transfer.cleanup), not the rows.
alter table public.transfers enable row level security;
alter table public.transfer_files enable row level security;
alter table public.transfer_misses enable row level security;
revoke all on public.transfers, public.transfer_files, public.transfer_misses from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit) values ('transfers', 'transfers', false, 104857600);

create function app_private.client_ip() returns text
language sql stable as $$ select nullif(trim(split_part(app_private.request_header('x-forwarded-for'), ',', 1)), '') $$;

create function app_private.b64url(p bytea) returns text
language sql immutable as $$ select rtrim(translate(encode(p, 'base64'), E'+/\n', '-_'), '=') $$;

-- An HS256 JWT of p_claims with Storage's secret, as Storage signs its signed URLs.
create function app_private.storage_token(p_claims jsonb) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_secret text := (select secret from app_private.jwt_secret);
  v_body text := app_private.b64url(convert_to('{"alg":"HS256","typ":"JWT"}', 'utf8')) || '.'
    || app_private.b64url(convert_to((p_claims || jsonb_build_object('iat', extract(epoch from now())::bigint))::text, 'utf8'));
begin
  if v_secret is null then
    raise exception 'app_private.jwt_secret is empty: restart the container so dolphin-migrate writes it';
  end if;
  return v_body || '.' || app_private.b64url(public.hmac(convert_to(v_body, 'utf8'), convert_to(v_secret, 'utf8'), 'sha256'));
end
$$;

create function app_private.url_encode(p text) returns text
language sql immutable as $$
  select coalesce(string_agg(case when c ~ '^[A-Za-z0-9_.~-]$' then c
    else upper(regexp_replace(encode(convert_to(c, 'utf8'), 'hex'), '(..)', '%\1', 'g')) end, '' order by i), '')
  from regexp_split_to_table(p, '') with ordinality x(c, i)
$$;

-- What a transfer looks like to its sender, receiver and the bank admin.
create function app_private.transfer_json(p public.transfers) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'created_at', p.ready_at, 'expires_at', p.expires_at, 'total', p.total,
    'files', (select jsonb_agg(jsonb_build_object('seq', f.seq, 'name', f.name, 'size', f.size) order by f.seq)
              from public.transfer_files f where f.transfer_id = p.id))
$$;

-- 发送, step 1: p_files [{"name","size"}] (1–20 files, each at most 100 MB, 200 MB in all). Returns the transfer's id and,
-- for each file, the URL to PUT it to (relative to the site, valid for 2 hours; a failed file can be put again).
create function public.create_transfer(p_files jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ip text := app_private.client_ip();
  v_total bigint;
  v_recent timestamptz[];
  v_transfer public.transfers;
begin
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 20
     or exists (select 1 from jsonb_array_elements(p_files) f
                where jsonb_typeof(f -> 'name') is distinct from 'string' or length(f ->> 'name') not between 1 and 255
                   or not app_private.json_int_between(f -> 'size', 0, 9007199254740991)) then
    perform app_private.fail('INVALID_INPUT', '{"field":"files"}');
  end if;
  if exists (select 1 from jsonb_array_elements(p_files) f where (f ->> 'size')::bigint > 104857600) then
    perform app_private.fail('FILE_TOO_LARGE', jsonb_build_object('field', 'file', 'max', 104857600,
      'name', (select f ->> 'name' from jsonb_array_elements(p_files) f where (f ->> 'size')::bigint > 104857600 limit 1)));
  end if;
  v_total := (select sum((f ->> 'size')::bigint) from jsonb_array_elements(p_files) f);
  if v_total > 209715200 then
    perform app_private.fail('FILE_TOO_LARGE', jsonb_build_object('field', 'total', 'max', 209715200, 'total', v_total));
  end if;
  v_recent := array(select created_at from public.transfers where ip is not distinct from v_ip
    and created_at > now() - interval '1 hour' order by created_at desc limit 10);
  if cardinality(v_recent) >= 10 then
    perform app_private.fail('RATE_LIMITED', jsonb_build_object('retry_at', v_recent[10] + interval '1 hour'));
  end if;
  -- One sender at a time checks the space and, in finish_transfer, takes a code.
  perform pg_advisory_xact_lock(hashtext('public.transfers'));
  if v_total + (select coalesce(sum(total), 0) from public.transfers
                where expires_at > now() or code is null and created_at > now() - interval '2 hours') > 5368709120 then
    perform app_private.fail('STORAGE_FULL');
  end if;
  insert into public.transfers (ip, total) values (v_ip, v_total) returning * into v_transfer;
  insert into public.transfer_files (transfer_id, seq, name, size)
  select v_transfer.id, i, f ->> 'name', (f ->> 'size')::bigint from jsonb_array_elements(p_files) with ordinality x(f, i);
  return jsonb_build_object('id', v_transfer.id, 'upload_until', v_transfer.created_at + interval '2 hours',
    'files', (select jsonb_agg(jsonb_build_object('seq', f.seq, 'name', f.name, 'size', f.size,
        'url', format('/storage/v1/object/upload/sign/transfers/%s/%s?token=%s', f.transfer_id, f.seq,
          app_private.storage_token(jsonb_build_object('url', format('transfers/%s/%s', f.transfer_id, f.seq),
            'scope', 'upload', 'upsert', true,
            'exp', extract(epoch from v_transfer.created_at + interval '2 hours')::bigint)))) order by f.seq)
      from public.transfer_files f where f.transfer_id = v_transfer.id));
end
$$;

-- 发送, step 2: once every file is in Storage at its declared size, a code no other transfer holds (0000–9999, at
-- random), valid 7 days. Again with the same id returns the same code.
create function public.finish_transfer(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_transfer public.transfers;
  v_missing jsonb;
  v_code text;
begin
  select * into v_transfer from public.transfers where id = p_id for update;
  if v_transfer.code is not null and v_transfer.expires_at > now() then
    return app_private.transfer_json(v_transfer) || jsonb_build_object('code', v_transfer.code);
  end if;
  if v_transfer.id is null or v_transfer.code is not null or v_transfer.created_at <= now() - interval '2 hours' then
    perform app_private.fail('TRANSFER_NOT_FOUND');
  end if;
  v_missing := (select jsonb_agg(f.seq order by f.seq) from public.transfer_files f
    where f.transfer_id = p_id and not exists (select 1 from storage.objects o where o.bucket_id = 'transfers'
                      and o.name = f.transfer_id || '/' || f.seq and (o.metadata ->> 'size')::bigint = f.size));
  if v_missing is not null then
    perform app_private.fail('TRANSFER_INCOMPLETE', jsonb_build_object('missing', v_missing));
  end if;
  perform pg_advisory_xact_lock(hashtext('public.transfers'));
  v_code := (select lpad(c::text, 4, '0') from generate_series(0, 9999) c
             where not exists (select 1 from public.transfers t where t.code = lpad(c::text, 4, '0'))
             order by random() limit 1);
  if v_code is null then
    perform app_private.fail('STORAGE_FULL');
  end if;
  update public.transfers set code = v_code, ready_at = now(), expires_at = now() + interval '7 days'
  where id = p_id returning * into v_transfer;
  return app_private.transfer_json(v_transfer) || jsonb_build_object('code', v_transfer.code);
end
$$;

-- 接收: the files of a code that has not expired, each with a download URL (relative to the site, saved under its name,
-- valid until the transfer expires). A wrong code is counted (so the reply is a 400 that commits, not an exception) and
-- 10 within 10 minutes lock the IP out for 10 minutes from the 10th.
create function public.open_transfer(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ip text := app_private.client_ip();
  v_misses timestamptz[] := array(select at from public.transfer_misses where ip is not distinct from v_ip
    and at > now() - interval '20 minutes' order by at desc limit 10);
  v_transfer public.transfers;
begin
  if cardinality(v_misses) = 10 and v_misses[1] - v_misses[10] <= interval '10 minutes'
     and now() < v_misses[1] + interval '10 minutes' then
    perform app_private.fail('RATE_LIMITED', jsonb_build_object('retry_at', v_misses[1] + interval '10 minutes'));
  end if;
  select * into v_transfer from public.transfers where code = p_code and expires_at > now();
  if v_transfer.id is null then
    insert into public.transfer_misses (ip) values (v_ip);
    perform set_config('response.status', '400', true);
    return jsonb_build_object('code', 'P0001', 'message', 'TRANSFER_NOT_FOUND', 'details', '{}', 'hint', null);
  end if;
  return app_private.transfer_json(v_transfer) || jsonb_build_object('code', v_transfer.code,
    'files', (select jsonb_agg(jsonb_build_object('seq', f.seq, 'name', f.name, 'size', f.size,
        'url', format('/storage/v1/object/sign/transfers/%s/%s?token=%s&download=%s', f.transfer_id, f.seq,
          app_private.storage_token(jsonb_build_object('url', format('transfers/%s/%s', f.transfer_id, f.seq),
            'scope', 'download', 'exp', extract(epoch from v_transfer.expires_at)::bigint)),
          app_private.url_encode(f.name))) order by f.seq)
      from public.transfer_files f where f.transfer_id = v_transfer.id));
end
$$;

-- 后台「文件传输」: the transfers with a code that have not expired, newest first, with their source IP.
create function public.list_transfers() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
begin
  perform app_private.forbid_president();
  return (select coalesce(jsonb_agg(app_private.transfer_json(t) || jsonb_build_object('ip', t.ip) order by t.ready_at desc), '[]')
    from public.transfers t where t.expires_at > now());
end
$$;

-- Deletes transfers and the Storage rows of their files, and with p_orphans those of transfers that no longer exist:
-- downloads stop at once, and dolphin jobs clean removes the files on disk. Returns the Storage rows deleted.
create function app_private.drop_transfers(p_ids uuid[], p_orphans boolean default false) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  -- Storage refuses direct deletes (its files would stay behind) unless asked for; dolphin jobs clean removes those.
  delete from public.transfers where id = any(p_ids);
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects o where o.bucket_id = 'transfers' and (split_part(o.name, '/', 1) = any(p_ids::text[])
    or p_orphans and not exists (select 1 from public.transfers t where t.id::text = split_part(o.name, '/', 1)));
  get diagnostics v_count = row_count;
  perform set_config('storage.allow_delete_query', 'false', true);
  return v_count;
end
$$;

-- 提前删除 by the bank admin, with a reason (1–200 characters); logged without the source IP.
create function public.delete_transfer(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_transfer public.transfers;
  v_json jsonb;
begin
  perform app_private.forbid_president();
  if coalesce(length(trim(p_reason)), 0) not between 1 and 200 then
    perform app_private.fail('INVALID_INPUT', '{"field":"reason"}');
  end if;
  select * into v_transfer from public.transfers where id = p_id and expires_at > now() for update;
  if v_transfer.id is null then
    perform app_private.fail('TRANSFER_NOT_FOUND');
  end if;
  v_json := app_private.transfer_json(v_transfer);
  perform app_private.drop_transfers(array[p_id]);
  perform app_private.log('transfer.delete', 'transfers:' || p_id, v_json, jsonb_build_object('reason', trim(p_reason)));
  return v_json;
end
$$;

-- The daily clean-up (dolphin jobs clean, PHASE-2.md §13): expired transfers, those not finished within their 2 hours,
-- Storage rows of transfers that no longer exist, and wrong codes older than a day. Run again, it finds nothing.
create function app_private.clean_transfers() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_expired uuid[] := array(select id from public.transfers where expires_at <= now());
  v_unfinished uuid[] := array(select id from public.transfers where code is null and created_at <= now() - interval '2 hours');
  v_files integer;
  v_orphans integer;
begin
  v_files := (select count(*) from storage.objects where bucket_id = 'transfers'
    and split_part(name, '/', 1) = any((v_expired || v_unfinished)::text[]));
  v_orphans := app_private.drop_transfers(v_expired || v_unfinished, true) - v_files;
  delete from public.transfer_misses where at < now() - interval '1 day';
  if cardinality(v_expired) + cardinality(v_unfinished) + v_orphans > 0 then
    perform app_private.log_system('transfer.cleanup', jsonb_build_object('expired', cardinality(v_expired),
      'unfinished', cardinality(v_unfinished), 'orphans', v_orphans));
  end if;
  return jsonb_build_object('expired', cardinality(v_expired), 'unfinished', cardinality(v_unfinished), 'orphans', v_orphans);
end
$$;
revoke execute on function app_private.clean_transfers() from public;

-- The first functions anon calls: the public pages are open to everyone, signed in or not.
revoke execute on function public.server_time(), public.public_rates(), public.create_transfer(jsonb),
  public.finish_transfer(uuid), public.open_transfer(text), public.list_transfers(), public.delete_transfer(uuid, text)
  from public, anon;
grant execute on function public.server_time(), public.public_rates(), public.create_transfer(jsonb),
  public.finish_transfer(uuid), public.open_transfer(text) to anon, authenticated;
grant execute on function public.list_transfers(), public.delete_transfer(uuid, text) to authenticated;
