-- 公开页面 (PHASE-2.md §16.4): server_time and public_rates for anyone; 文件传输's codes (random, unique, 7 days), its
-- limits (files, sizes, space), its two rate limits by IP, the signed Storage URLs, the daily clean-up, and the bank
-- admin's list and early deletion. The real upload and download through Storage are in docker/smoke-test.sh.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.student('s1', 50, '张小明') as s1 \gset

-- Runs sql as anon (not signed in) from p_ip: its jsonb result, or {"error","detail"}; response.status is what it set.
create function tests.anon(p_sql text, p_ip text default '203.0.113.1') returns jsonb language plpgsql as $$
declare
  v_result jsonb;
  v_detail text;
begin
  perform set_config('request.headers', json_build_object('x-forwarded-for', p_ip)::text, true);
  perform set_config('response.status', '', true);
  begin
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('role', 'anon', true);
    execute p_sql into v_result;
    perform set_config('role', 'none', true);
    return v_result;
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return jsonb_build_object('error', sqlerrm, 'detail', v_detail);
  end;
end $$;

-- A file landing in Storage, as Storage records it.
create function tests.upload(p_id text, p_seq integer, p_size bigint) returns void language sql as $$
  insert into storage.objects (bucket_id, name, metadata) values ('transfers', p_id || '/' || p_seq, jsonb_build_object('size', p_size))
$$;

-- Sends p_files from an IP of its own: create, upload each, finish. Returns finish_transfer's result.
create function tests.send(p_files jsonb default '[{"name":"a.txt","size":5}]') returns jsonb language plpgsql as $$
declare
  v_ip text := gen_random_uuid()::text;
  v jsonb := tests.anon(format('select create_transfer(%L)', p_files), v_ip);
  f jsonb;
begin
  for f in select * from jsonb_array_elements(v -> 'files') loop
    perform tests.upload(v ->> 'id', (f ->> 'seq')::integer, (f ->> 'size')::bigint);
  end loop;
  return tests.anon(format('select finish_transfer(%L)', v ->> 'id'), v_ip);
end $$;

create function tests.token(p_url text) returns text language sql as $$ select substring(p_url from 'token=([^&]+)') $$;
-- Whether a token carries an HS256 signature of its header and claims with Storage's secret.
create function tests.signed(p_token text) returns boolean language sql as $$
  select split_part(p_token, '.', 3) = rtrim(translate(encode(hmac(convert_to(split_part(p_token, '.', 1) || '.' || split_part(p_token, '.', 2), 'utf8'),
    convert_to((select secret from app_private.jwt_secret), 'utf8'), 'sha256'), 'base64'), E'+/\n', '-_'), '=')
$$;
create function tests.claims(p_token text) returns jsonb language sql as $$
  select convert_from(decode(rpad(translate(split_part(p_token, '.', 2), '-_', '+/'),
    (length(split_part(p_token, '.', 2)) + 3) / 4 * 4, '='), 'base64'), 'utf8')::jsonb
$$;

-- 大屏时间 ---------------------------------------------------------------------------------------------------------

select ok(abs((tests.anon('select to_jsonb(server_time())'))::text::bigint - extract(epoch from clock_timestamp()) * 1000) < 1000,
  'server_time: the server clock in milliseconds, for anon');

-- 利率看板 ---------------------------------------------------------------------------------------------------------

-- The 理财 card for 12 weeks under wealth_params: day, change, closed and each tier at that change (null: no rates).
create function tests.wealth(p_day date, p_change numeric, p_closed boolean) returns jsonb language sql as $$
  select jsonb_build_object('name', p ->> 'name', 'weeks', 12, 'day', p_day, 'change', p_change, 'closed', p_closed,
    'tiers', (select jsonb_agg(jsonb_build_object('key', t ->> 'key', 'name', t ->> 'name', 'multiplier', (t ->> 'multiplier')::numeric,
        'rate', case when p_change is not null then app_private.tier_rate(p, 12, t, p_change) end) order by i)
      from jsonb_array_elements(p -> 'tiers') with ordinality x(t, i)))
  from (select app_private.setting('wealth_params') as p) w
$$;
create function tests.trading_day(p_day date, p_change numeric) returns void language sql as $$
  insert into wealth_days (day, change, source, note, params) values (p_day, p_change, 'manual', '测试', app_private.setting('wealth_params'))
$$;
-- wealth_days is append-only; the cases below start from none.
create function tests.no_trading_days() returns void language sql as $$
  set local session_replication_role = replica;
  delete from wealth_days;
  set local session_replication_role = origin;
$$;
select app_private.cn_date(now()) as today, extract(isodow from app_private.cn_date(now())) >= 6 as weekend \gset

select tests.no_trading_days();
select tests.anon('select public_rates()') as rates \gset
select is((select array_agg(k order by k) from jsonb_object_keys(:'rates'::jsonb) k), array['credit_enabled', 'current', 'scores', 'term', 'wealth'],
  'public_rates for anon: no anchor');
select is((:'rates'::jsonb ->> 'current')::numeric, app_private.saving_rate(app_private.anchor_on(:'today'), 600), '活期: one rate for everyone');
select is(:'rates'::jsonb -> 'scores', (select jsonb_agg(jsonb_build_object('score', s, 'loan', app_private.loan_rate(app_private.anchor_on(:'today'), s)) order by s)
  from unnest(array[600, 750, 900, 1000]) s), 'loan rates at 600, 750, 900 and 1000 under this week''s anchor');
select is(:'rates'::jsonb -> 'term', app_private.setting('term_rates'), 'the five fixed 定期 rates');
select is(:'rates'::jsonb -> 'wealth', case when :'weekend' then tests.wealth(:'today', 0, true) else tests.wealth(null, null, false) end,
  '理财 with no trading day yet: no rates (on a weekend, closed: the bases)');
select ok(:'rates'::jsonb -> 'credit_enabled' = 'true' and :'rates' not like '%张小明%' and :'rates' not like '%"s1"%', 'nothing about anyone');

select tests.trading_day(:'today'::date - 10, 1.5);
select is(tests.anon('select public_rates()') -> 'wealth',
  case when :'weekend' then tests.wealth(:'today', 0, true) else tests.wealth(:'today'::date - 10, 1.5, false) end,
  '理财: each tier for 12 weeks on the latest trading day (on a weekend, closed: the bases)');
select tests.trading_day(:'today', -3);
select tests.anon('select public_rates()') -> 'wealth' as wealth \gset
select is(:'wealth'::jsonb, tests.wealth(:'today', -3, false), 'today''s close in: each tier on it');
select is(:'wealth'::jsonb -> 'tiers', (select jsonb_agg(jsonb_build_object('key', t ->> 'key', 'name', t ->> 'name',
    'multiplier', (t ->> 'multiplier')::numeric, 'rate', (t ->> 'min')::numeric) order by i)
  from jsonb_array_elements(app_private.setting('wealth_params') -> 'tiers') with ordinality x(t, i)), 'a −3% day takes each tier to its floor');
select tests.no_trading_days();
select tests.trading_day(:'today'::date + 3, 0.8);
select is(tests.anon('select public_rates()') -> 'wealth', tests.wealth(:'today', 0, true),
  'today closed (a later day traded, no close today): today, the bases');
select is((select jsonb_agg(t -> 'rate') from jsonb_array_elements(tests.anon('select public_rates()') -> 'wealth' -> 'tiers') t),
  (select jsonb_agg(to_jsonb(app_private.day_base((app_private.setting('wealth_params') -> 'base' ->> '12')::numeric))) from generate_series(1, 3)),
  'which are the 12-week daily base');

select tests.call(:'teacher', 'select set_credit_enabled(false, ''期中检查'')');
select is(tests.anon('select public_rates()') -> 'scores', jsonb_build_array(jsonb_build_object('score', 600,
    'loan', app_private.loan_rate(app_private.anchor_on(:'today'), 600))), '信用分 paused: the loan rate at 600 alone, as every student is at 600');
select is((tests.anon('select public_rates()') ->> 'current')::numeric, app_private.saving_rate(app_private.anchor_on(:'today'), 600), '活期 as before');
select is(tests.anon('select public_rates()') -> 'credit_enabled', 'false', 'and says so');
select tests.call(:'teacher', 'select set_credit_enabled(true, null)');

-- 文件传输: what a sender may send ----------------------------------------------------------------------------------

select is(tests.anon(format('select create_transfer(%L)', f)) ->> 'detail', '{"field": "files"}', 'INVALID_INPUT: ' || why)
from (values ('[]', 'no files'), ('{}', 'not a list'), ('[{"name":"","size":1}]', 'an empty name'),
  ('[{"name":"a","size":-1}]', 'a negative size'), ('[{"name":"a","size":1.5}]', 'a fractional size'),
  ('[{"size":1}]', 'no name'), (format('[{"name":"%s","size":1}]', repeat('名', 256)), 'a name over 255 characters')) x(f, why);
select is(tests.anon(format('select create_transfer(%L)', (select jsonb_agg(jsonb_build_object('name', 'f' || i, 'size', 1)) from generate_series(1, 23) i))),
  '{"error": "FILE_TOO_LARGE", "detail": "{\"max\": 20, \"count\": 23, \"field\": \"count\"}"}', 'more than 20 files: the limit and the count');
select is(tests.anon('select create_transfer(''[{"name":"视频.mp4","size":272629760},{"name":"a","size":1},{"name":"大.mp4","size":104857601}]'')') ->> 'detail',
  '{"max": 104857600, "field": "file", "files": [{"name": "视频.mp4", "size": 272629760}, {"name": "大.mp4", "size": 104857601}]}',
  'files over 100 MB: each with its name and size');
select is(tests.anon('select create_transfer(''[{"name":"a","size":70000000},{"name":"b","size":70000000},{"name":"c","size":70000000}]'')'),
  '{"error": "FILE_TOO_LARGE", "detail": "{\"max\": 209715200, \"field\": \"total\", \"total\": 210000000}"}', 'over 200 MB in all');

select tests.anon(format('select create_transfer(%L)', (select jsonb_agg(jsonb_build_object('name', '文件 ' || i,
  'size', case when i = 1 then 104857600 when i = 2 then 104857600 - 19 else 1 end)) from generate_series(1, 20) i)), '192.0.2.1') as created \gset
select is(jsonb_array_length(:'created'::jsonb -> 'files'), 20, '20 files, 100 MB for one and 200 MB in all are accepted');
select ok((select bool_and(f ->> 'url' ~ ('^/storage/v1/object/upload/sign/transfers/' || (:'created'::jsonb ->> 'id') || '/' || (f ->> 'seq')
    || '\?token=[\w-]+\.[\w-]+\.[\w-]+$')) from jsonb_array_elements(:'created'::jsonb -> 'files') f),
  'each file has its signed upload URL, transfers/<id>/<seq>');
select ok(tests.signed(tests.token(:'created'::jsonb -> 'files' -> 1 ->> 'url')), 'signed with Storage''s secret');
select is(tests.claims(tests.token(:'created'::jsonb -> 'files' -> 1 ->> 'url')) - 'iat',
  jsonb_build_object('url', 'transfers/' || (:'created'::jsonb ->> 'id') || '/2', 'scope', 'upload', 'upsert', true,
    'exp', extract(epoch from now() + interval '2 hours')::bigint), 'for that one object, uploads only, valid 2 hours');
select is(:'created'::jsonb ->> 'upload_until', to_jsonb(now() + interval '2 hours') #>> '{}', 'upload_until');
select is((select ip from transfers where id = (:'created'::jsonb ->> 'id')::uuid), '192.0.2.1', 'the transfer keeps its source IP');

-- Finishing: every file in Storage at its size first, then a code ------------------------------------------------

select tests.anon('select create_transfer(''[{"name":"a.txt","size":5},{"name":"b.txt","size":7}]'')', '192.0.2.2') as two \gset
select is(tests.anon(format('select finish_transfer(%L)', :'two'::jsonb ->> 'id'), '192.0.2.2'),
  '{"error": "TRANSFER_INCOMPLETE", "detail": "{\"missing\": [1, 2]}"}', 'nothing uploaded yet');
select tests.upload(:'two'::jsonb ->> 'id', 1, 4);
select is(tests.anon(format('select finish_transfer(%L)', :'two'::jsonb ->> 'id')) ->> 'detail', '{"missing": [1, 2]}',
  'a file of another size counts as missing');
update storage.objects set metadata = '{"size":5}' where bucket_id = 'transfers' and name = (:'two'::jsonb ->> 'id') || '/1';
select is(tests.anon(format('select finish_transfer(%L)', :'two'::jsonb ->> 'id')) ->> 'detail', '{"missing": [2]}', 'uploaded again');
select tests.upload(:'two'::jsonb ->> 'id', 2, 7);
select tests.anon(format('select finish_transfer(%L)', :'two'::jsonb ->> 'id')) as done \gset
select ok(:'done'::jsonb ->> 'code' ~ '^[0-9]{4}$', 'then a 4-digit code');
select is(:'done'::jsonb - 'code', jsonb_build_object('id', :'two'::jsonb ->> 'id', 'created_at', now(), 'expires_at', now() + interval '7 days',
  'total', 12, 'files', '[{"seq":1,"name":"a.txt","size":5},{"seq":2,"name":"b.txt","size":7}]'::jsonb), 'valid 7 days from now; no IP');
select is(tests.anon(format('select finish_transfer(%L)', :'two'::jsonb ->> 'id')), :'done'::jsonb, 'finishing again returns the same code');
select is(tests.anon(format('select finish_transfer(%L)', gen_random_uuid())) ->> 'error', 'TRANSFER_NOT_FOUND', 'an unknown transfer');
update transfers set created_at = created_at - interval '2 hours' where id = (:'created'::jsonb ->> 'id')::uuid;
select is(tests.anon(format('select finish_transfer(%L)', :'created'::jsonb ->> 'id')) ->> 'error', 'TRANSFER_NOT_FOUND',
  'nor after its 2 hours of uploading');

-- Receiving -----------------------------------------------------------------------------------------------------

select tests.send('[{"name":"报告 v2.pdf","size":3},{"name":"a&b=c?.txt","size":4}]') as sent \gset
select tests.anon(format('select open_transfer(%L)', :'sent'::jsonb ->> 'code'), '192.0.2.3') as opened \gset
select is(:'opened'::jsonb - 'files', :'sent'::jsonb - 'files', 'a code opens its transfer: its code, times and total, no IP');
select is((select jsonb_agg(f - 'url') from jsonb_array_elements(:'opened'::jsonb -> 'files') f), :'sent'::jsonb -> 'files', 'and its files');
select is(regexp_replace(:'opened'::jsonb -> 'files' -> 0 ->> 'url', 'token=[^&]+', 'token=T'),
  format('/storage/v1/object/sign/transfers/%s/1?token=T&download=%%E6%%8A%%A5%%E5%%91%%8A%%20v2.pdf', :'sent'::jsonb ->> 'id'),
  'each with a signed download URL that saves it under its name');
select ok((:'opened'::jsonb -> 'files' -> 1 ->> 'url') like '%&download=a%26b%3Dc%3F.txt', 'the name encoded for the URL');
select ok(tests.signed(tests.token(:'opened'::jsonb -> 'files' -> 0 ->> 'url')), 'signed with Storage''s secret');
select is(tests.claims(tests.token(:'opened'::jsonb -> 'files' -> 0 ->> 'url')) - 'iat',
  jsonb_build_object('url', 'transfers/' || (:'sent'::jsonb ->> 'id') || '/1', 'scope', 'download',
    'exp', extract(epoch from (:'sent'::jsonb ->> 'expires_at')::timestamptz)::bigint), 'downloads only, valid until the transfer expires');
select is(tests.anon(format('select open_transfer(%L)', :'sent'::jsonb ->> 'code')) -> 'files', :'opened'::jsonb -> 'files', 'again and again');

select is(tests.anon('select open_transfer(''12a4'')', '192.0.2.4'),
  '{"code": "P0001", "hint": null, "details": "{}", "message": "TRANSFER_NOT_FOUND"}', 'a wrong code: TRANSFER_NOT_FOUND');
select is(current_setting('response.status'), '400', 'as a 400');
select is((select count(*) from transfer_misses where ip = '192.0.2.4'), 1::bigint, 'counted for its IP');

-- 7 days: the code stops at its expiry.
update transfers set created_at = created_at - interval '7 days', ready_at = ready_at - interval '7 days',
  expires_at = expires_at - interval '7 days' where id = (:'sent'::jsonb ->> 'id')::uuid;
select is(tests.anon(format('select open_transfer(%L)', :'sent'::jsonb ->> 'code')) ->> 'message', 'TRANSFER_NOT_FOUND', 'expired after 7 days');
select is(tests.anon(format('select finish_transfer(%L)', :'sent'::jsonb ->> 'id')) ->> 'error', 'TRANSFER_NOT_FOUND', 'and not finished again');

-- Codes: random, and none held by another transfer.
create table tests.codes as select tests.send() ->> 'code' as code from generate_series(1, 30);
select is((select count(distinct code) from tests.codes), 30::bigint, '30 transfers, 30 codes');
select ok((select count(*) from tests.codes where code < '0030') < 30, 'taken at random, not in order');
insert into transfers (total, code, ready_at, expires_at)
select 0, lpad(c::text, 4, '0'), now(), now() + interval '1 day' from generate_series(0, 9999) c
where lpad(c::text, 4, '0') <> '0427' and not exists (select 1 from transfers t where t.code = lpad(c::text, 4, '0'));
select is(tests.send() ->> 'code', '0427', 'the one code free');
select is(tests.send() ->> 'error', 'STORAGE_FULL', 'none free: STORAGE_FULL');
delete from transfers where total = 0 and code is not null;

-- Limits by IP ------------------------------------------------------------------------------------------------------

select is((select count(*) from generate_series(1, 10) where tests.anon('select create_transfer(''[{"name":"a","size":1}]'')', '192.0.2.20') ? 'id'),
  10::bigint, '10 uploads within an hour from one IP');
select is(tests.anon('select create_transfer(''[{"name":"a","size":1}]'')', '192.0.2.20'),
  jsonb_build_object('error', 'RATE_LIMITED', 'detail', jsonb_build_object('retry_at', now() + interval '1 hour')::text), 'the 11th: RATE_LIMITED');
select ok(tests.anon('select create_transfer(''[{"name":"a","size":1}]'')', '192.0.2.21') ? 'id', 'another IP is not');
update transfers set created_at = created_at - interval '1 hour' where ip = '192.0.2.20';
select ok(tests.anon('select create_transfer(''[{"name":"a","size":1}]'')', '192.0.2.20') ? 'id', 'an hour later it uploads again');

select tests.send() ->> 'code' as code \gset
select is((select count(*) from generate_series(1, 9) where tests.anon('select open_transfer(''9x9x'')', '192.0.2.30') ->> 'message' = 'TRANSFER_NOT_FOUND'),
  9::bigint, '9 wrong codes');
select ok(tests.anon(format('select open_transfer(%L)', :'code'), '192.0.2.30') ? 'files', 'the right one still opens');
select is(tests.anon('select open_transfer(''9x9x'')', '192.0.2.30') ->> 'message', 'TRANSFER_NOT_FOUND', 'the 10th wrong code');
select is(tests.anon(format('select open_transfer(%L)', :'code'), '192.0.2.30'),
  jsonb_build_object('error', 'RATE_LIMITED', 'detail', jsonb_build_object('retry_at', now() + interval '10 minutes')::text),
  'then even the right code: RATE_LIMITED for 10 minutes');
select is((select count(*) from transfer_misses where ip = '192.0.2.30'), 10::bigint, 'refused tries are not counted');
select ok(tests.anon(format('select open_transfer(%L)', :'code'), '192.0.2.31') ? 'files', 'another IP is not locked');
update transfer_misses set at = at - interval '10 minutes' where ip = '192.0.2.30';
select ok(tests.anon(format('select open_transfer(%L)', :'code'), '192.0.2.30') ? 'files', '10 minutes later it opens again');
insert into transfer_misses (ip, at) select '192.0.2.32', now() - interval '11 minutes'
  union all select '192.0.2.32', now() - interval '1 minute' from generate_series(1, 8);
select is(tests.anon('select open_transfer(''9x9x'')', '192.0.2.32') ->> 'message', 'TRANSFER_NOT_FOUND', '10 wrong codes over 11 minutes');
select ok(tests.anon(format('select open_transfer(%L)', :'code'), '192.0.2.32') ? 'files', 'do not lock');

-- Space: 5 GB of transfers not expired (and of uploads under way) -------------------------------------------------

insert into transfers (total, code, ready_at, expires_at)
select 5368709120 - (select coalesce(sum(total), 0) from transfers where expires_at > now() or code is null and created_at > now() - interval '2 hours') - 10,
  (select lpad(c::text, 4, '0') from generate_series(0, 9999) c where not exists (select 1 from transfers t where t.code = lpad(c::text, 4, '0')) limit 1),
  now(), now() + interval '1 day' returning id as full \gset
select is(tests.anon('select create_transfer(''[{"name":"a","size":11}]'')', '192.0.2.40'), '{"error": "STORAGE_FULL", "detail": "{}"}',
  'STORAGE_FULL past 5 GB');
select tests.anon('select create_transfer(''[{"name":"a","size":10}]'')', '192.0.2.40') as last \gset
select ok(:'last'::jsonb ? 'id', 'up to 5 GB');
select is(tests.anon('select create_transfer(''[{"name":"a","size":0}]'')', '192.0.2.40') ? 'id', true, 'an empty file fits still');
select is(tests.anon('select create_transfer(''[{"name":"a","size":1}]'')', '192.0.2.40') ->> 'error', 'STORAGE_FULL',
  'an upload under way holds its space');
update transfers set created_at = created_at - interval '2 hours' where id = (:'last'::jsonb ->> 'id')::uuid;
select ok(tests.anon('select create_transfer(''[{"name":"a","size":1}]'')', '192.0.2.40') ? 'id', 'until its 2 hours are over');
update transfers set expires_at = now() where id = :'full';
select ok(tests.anon('select create_transfer(''[{"name":"a","size":1000}]'')', '192.0.2.40') ? 'id', 'an expired transfer holds none');

-- The daily clean-up ------------------------------------------------------------------------------------------------

select app_private.drop_transfers(array(select id from transfers), true);
select tests.send() as expired \gset
update transfers set expires_at = now() where id = (:'expired'::jsonb ->> 'id')::uuid;
select tests.anon('select create_transfer(''[{"name":"a","size":1}]'')', '192.0.2.50') as stale \gset
select tests.upload(:'stale'::jsonb ->> 'id', 1, 1);
update transfers set created_at = now() - interval '2 hours' where id = (:'stale'::jsonb ->> 'id')::uuid;
select tests.anon('select create_transfer(''[{"name":"a","size":1}]'')', '192.0.2.51') as uploading \gset
select tests.upload(:'uploading'::jsonb ->> 'id', 1, 1);
update transfers set created_at = now() - interval '1 hour' where id = (:'uploading'::jsonb ->> 'id')::uuid;
select tests.send() as live \gset
select tests.upload(gen_random_uuid()::text, 1, 1);
insert into transfer_misses (ip, at) values ('192.0.2.52', now() - interval '25 hours'), ('192.0.2.53', now() - interval '23 hours');
select is(app_private.clean_transfers(), '{"expired": 1, "orphans": 1, "unfinished": 1}', 'clean-up: the expired, the unfinished after 2 hours, an orphan file');
select is(array(select split_part(name, '/', 1) from storage.objects where bucket_id = 'transfers' order by 1),
  array(select x from unnest(array[:'uploading'::jsonb ->> 'id', :'live'::jsonb ->> 'id']) x order by 1), 'their Storage rows are gone');
select is(array(select id::text from transfers order by 1),
  array(select x from unnest(array[:'uploading'::jsonb ->> 'id', :'live'::jsonb ->> 'id']) x order by 1), 'so are their records and IPs');
select is(array(select ip from transfer_misses where ip like '192.0.2.5%'), array['192.0.2.53'], 'wrong codes older than a day go');
select is((select row(actor_id, after)::text from audit_log where action = 'transfer.cleanup' order by id desc limit 1),
  row(null::uuid, '{"expired": 1, "orphans": 1, "unfinished": 1}'::jsonb)::text, 'logged as the system');
select count(*) as logs from audit_log where action = 'transfer.cleanup' \gset
select is(app_private.clean_transfers(), '{"expired": 0, "orphans": 0, "unfinished": 0}', 'run again: nothing');
select is((select count(*) from audit_log where action = 'transfer.cleanup'), :'logs'::bigint, 'and nothing logged');

-- 后台: the bank admin lists and deletes ----------------------------------------------------------------------------

select is(tests.call(:'teacher', 'select list_transfers()'), jsonb_build_object('count', 1, 'total', 5, 'limit', 5368709120,
  'transfers', jsonb_build_array((:'live'::jsonb - 'code') || jsonb_build_object('ip', (select ip from transfers where id = (:'live'::jsonb ->> 'id')::uuid)))),
  'the bank admin lists the transfers not expired with their IP, no code; their count, size and the 5 GB limit');
select is(tests.err(w, 'select list_transfers()'), 'FORBIDDEN', format('%s: no list', n))
from (values (:'president'::uuid, 'the president'), (:'teller'::uuid, 'a teller'), (:'s1'::uuid, 'a student')) x(w, n);
select is(tests.anon('select list_transfers()') ->> 'error', 'permission denied for function list_transfers', 'nor anon');
select is(tests.err(:'president', format('select delete_transfer(%L, ''违规'')', :'live'::jsonb ->> 'id')), 'FORBIDDEN', 'the president deletes none');
select is(tests.call(:'teacher', format('select delete_transfer(%L, %L)', :'live'::jsonb ->> 'id', r)) ->> 'detail', '{"field": "reason"}',
  'a reason is required: ' || why)
from (values (null, 'none'), ('  ', 'blank'), (repeat('因', 201), 'over 200 characters')) x(r, why);
select is(tests.call(:'teacher', format('select delete_transfer(%L, '' 内容不当 '')', :'live'::jsonb ->> 'id')), :'live'::jsonb - 'code',
  'the bank admin deletes one early');
select is((select row(actor_id, target, before, after)::text from audit_log where action = 'transfer.delete'),
  row(:'teacher'::uuid, 'transfers:' || (:'live'::jsonb ->> 'id'), :'live'::jsonb - 'code', '{"reason": "内容不当"}'::jsonb)::text,
  'logged with the reason, without the IP');
select is(tests.anon(format('select open_transfer(%L)', :'live'::jsonb ->> 'code')) ->> 'message', 'TRANSFER_NOT_FOUND', 'its code opens nothing');
select ok(not exists (select 1 from storage.objects where bucket_id = 'transfers' and name like (:'live'::jsonb ->> 'id') || '/%'),
  'its files are out of Storage''s records');
select is(tests.err(:'teacher', format('select delete_transfer(%L, ''x'')', :'live'::jsonb ->> 'id')), 'TRANSFER_NOT_FOUND', 'deleted once');

-- anon reads and writes no table of them.
select is(tests.anon(format('select to_jsonb(count(*)) from %s', t)) ->> 'error', 'permission denied for table ' || t, 'anon cannot read ' || t)
from unnest(array['transfers', 'transfer_files', 'transfer_misses']) t;

select * from finish();
rollback;
