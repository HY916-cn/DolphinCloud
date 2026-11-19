-- 文件传输 as the front end shows it (PHASE-2.md §15, §16.4): a refusal for size says which limit, the limit and the
-- value (more than 20 files, each file over 100 MB with its name and size, over 200 MB in all), and the bank admin's list
-- comes with the count and size of the transfers not expired and the 5 GB limit.

-- create_transfer as in 20261208000000_public_pages.sql: FILE_TOO_LARGE {"field":"count","max":20,"count"} for more than
-- 20 files (INVALID_INPUT before), and {"field":"file","max","files":[{"name","size"}]} with every file over 100 MB.
create or replace function public.create_transfer(p_files jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ip text := app_private.client_ip();
  v_total bigint;
  v_recent timestamptz[];
  v_transfer public.transfers;
begin
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) = 0
     or exists (select 1 from jsonb_array_elements(p_files) f
                where jsonb_typeof(f -> 'name') is distinct from 'string' or length(f ->> 'name') not between 1 and 255
                   or not app_private.json_int_between(f -> 'size', 0, 9007199254740991)) then
    perform app_private.fail('INVALID_INPUT', '{"field":"files"}');
  end if;
  if jsonb_array_length(p_files) > 20 then
    perform app_private.fail('FILE_TOO_LARGE', jsonb_build_object('field', 'count', 'max', 20, 'count', jsonb_array_length(p_files)));
  end if;
  if exists (select 1 from jsonb_array_elements(p_files) f where (f ->> 'size')::bigint > 104857600) then
    perform app_private.fail('FILE_TOO_LARGE', jsonb_build_object('field', 'file', 'max', 104857600,
      'files', (select jsonb_agg(jsonb_build_object('name', f ->> 'name', 'size', (f ->> 'size')::bigint) order by i)
                from jsonb_array_elements(p_files) with ordinality x(f, i) where (f ->> 'size')::bigint > 104857600)));
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

-- list_transfers as in 20261208000000_public_pages.sql: {"count","total","limit","transfers":[…]}, count and total
-- (bytes) of the transfers not expired; limit is the 5 GB that they and the uploads under way share.
create or replace function public.list_transfers() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
begin
  perform app_private.forbid_president();
  return (select jsonb_build_object('count', count(*), 'total', coalesce(sum(t.total), 0), 'limit', 5368709120,
      'transfers', coalesce(jsonb_agg(app_private.transfer_json(t) || jsonb_build_object('ip', t.ip) order by t.ready_at desc), '[]'))
    from public.transfers t where t.expires_at > now());
end
$$;
