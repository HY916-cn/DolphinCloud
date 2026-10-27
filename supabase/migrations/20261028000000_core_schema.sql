-- Phase 1 tables, invariants, audit and row-level security (PHASE-1.md §5, §6.6).
-- Business tables are read-only for `authenticated`; every write goes through the security definer functions
-- in the following migrations. Helpers live in app_private, which PostgREST does not expose.

-- New functions are not executable by PUBLIC (so not by anon); each RPC is granted to authenticated explicitly.
alter default privileges for role postgres revoke execute on functions from public;
revoke execute on function app_private.create_login(text, text) from public;
grant usage on schema app_private to authenticated;

-- Tables ---------------------------------------------------------------------------------------------------

create table public.profiles (
  id                   uuid primary key references auth.users(id),
  login_kind           text not null check (login_kind in ('student','staff')),
  login_id             text not null,
  display_name         text not null,
  must_change_password boolean not null default true,
  disabled             boolean not null default false,
  created_at           timestamptz not null default now(),
  unique (login_kind, login_id)
);

create type public.app_role as enum ('teller','accountant','storekeeper','teacher','sysadmin');

create table public.user_roles (
  user_id uuid references public.profiles(id),
  role    public.app_role not null,
  primary key (user_id, role)
);

create table public.students (
  student_no text primary key,
  user_id    uuid unique references public.profiles(id),
  name       text not null,
  grade      text not null,
  class_name text not null,
  cohort     text,
  status     text not null default 'normal' check (status in ('normal','frozen','graduated')),
  opened_at  timestamptz not null default now()
);

create table public.accounts (
  student_no  text primary key references public.students(student_no),
  balance     integer not null default 0 check (balance >= 0),
  total_in    integer not null default 0,
  total_out   integer not null default 0,
  total_spent integer not null default 0,
  updated_at  timestamptz not null default now()
);

create type public.txn_type as enum ('opening','deposit','withdraw','purchase','reversal');

create table public.txns (
  id                uuid primary key,
  seq               bigserial unique,
  txn_no            text unique not null,
  type              public.txn_type not null,
  student_no        text not null references public.students(student_no),
  amount            integer not null check (amount > 0),
  balance_delta     integer not null,
  balance_after     integer not null,
  cash_delta        integer not null default 0,
  payment           text check (payment in ('account','cash')),
  denominations     jsonb,
  change_given      jsonb,
  status            text not null default 'normal' check (status in ('normal','reversed')),
  reversal_of       uuid unique references public.txns(id),
  reason            text,
  operator_id       uuid not null references public.profiles(id),
  device_id         text,
  offline           boolean not null default false,
  client_created_at timestamptz,
  created_at        timestamptz not null default now()
);
create unique index txns_one_opening on public.txns(student_no) where type = 'opening';
create index on public.txns (student_no, created_at desc);
create index on public.txns (operator_id, created_at desc);
create index on public.txns (type, created_at desc);
create index on public.txns (created_at desc);

create table public.products (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  image_path   text,
  price        integer not null check (price > 0),
  cost         integer,
  category     text,
  listed       boolean not null default false,
  stock        integer not null default 0 check (stock >= 0),
  safety_stock integer,
  updated_at   timestamptz not null default now()
);

create table public.txn_items (
  txn_id     uuid references public.txns(id),
  product_id uuid references public.products(id),
  name       text not null,
  unit_price integer not null,
  qty        integer not null check (qty > 0),
  primary key (txn_id, product_id)
);

create table public.stock_movements (
  id          bigserial primary key,
  product_id  uuid not null references public.products(id),
  kind        text not null check (kind in ('stock_in','sale','reversal')),
  qty_delta   integer not null,
  txn_id      uuid references public.txns(id),
  operator_id uuid not null references public.profiles(id),
  note        text,
  created_at  timestamptz not null default now()
);
create index on public.stock_movements (product_id, created_at desc);

create table public.currency_issues (
  id            uuid primary key default gen_random_uuid(),
  batch_no      text unique not null,
  issued_on     date not null,
  denominations jsonb not null,
  total         integer not null,
  purpose       text not null,
  approver_name text not null,
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now()
);

create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor_id   uuid,
  action     text not null,
  target     text,
  before     jsonb,
  after      jsonb,
  ip         text,
  device_id  text,
  user_agent text
);
create index on public.audit_log (at desc);

insert into public.settings (key, value) values
  ('denominations', '[1,2,5,10]'),
  ('withdraw_single_limit', '200'),
  ('withdraw_daily_limit', '500'),
  ('ranking_anonymous', 'true'),
  ('ranking_size', '10');

-- Helpers --------------------------------------------------------------------------------------------------

-- Raises a fixed error code (PHASE-1.md §7.5) with a JSON detail for the client.
create function app_private.fail(p_code text, p_detail jsonb default null, p_errcode text default 'P0001')
returns void language plpgsql as $$
begin
  raise exception using message = p_code, detail = coalesce(p_detail, '{}')::text, errcode = p_errcode;
end
$$;

-- "Today" and "that day" are counted in Asia/Shanghai whatever the server time zone is.
create function app_private.cn_date(p_at timestamptz) returns date
language sql immutable as $$ select (p_at at time zone 'Asia/Shanghai')::date $$;

create function app_private.has_role(p_role public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
    where r.user_id = auth.uid() and r.role = p_role and not p.disabled
  )
$$;

-- Returns the caller's id when they hold any of the roles, otherwise raises FORBIDDEN (HTTP 403).
create function app_private.require_role(variadic p_roles public.app_role[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from unnest(p_roles) r where app_private.has_role(r)) then
    perform app_private.fail('FORBIDDEN', jsonb_build_object('roles', p_roles), '42501');
  end if;
  return auth.uid();
end
$$;

create function app_private.my_student_no() returns text
language sql stable security definer set search_path = '' as $$
  select student_no from public.students where user_id = auth.uid()
$$;

create function app_private.setting(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select value from public.settings where key = p_key
$$;

create function app_private.request_header(p_name text) returns text
language sql stable as $$ select nullif(current_setting('request.headers', true), '')::json ->> p_name $$;

create function app_private.log(p_action text, p_target text, p_before jsonb default null, p_after jsonb default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, action, target, before, after, ip, device_id, user_agent)
  values (auth.uid(), p_action, p_target, p_before, p_after,
          trim(split_part(app_private.request_header('x-forwarded-for'), ',', 1)),
          app_private.request_header('x-device-id'),
          app_private.request_header('user-agent'))
$$;

grant execute on function app_private.has_role(public.app_role), app_private.my_student_no(), app_private.cn_date(timestamptz)
  to authenticated;

-- Invariants -----------------------------------------------------------------------------------------------

-- Transaction number: HT + YYMMDD + 6 digits from the sequence.
create function app_private.txns_number() returns trigger language plpgsql as $$
begin
  new.txn_no := coalesce(new.txn_no,
    'HT' || to_char(new.created_at at time zone 'Asia/Shanghai', 'YYMMDD') || lpad((new.seq % 1000000)::text, 6, '0'));
  return new;
end
$$;
create trigger txns_number before insert on public.txns for each row execute function app_private.txns_number();

-- Ledger rows are append-only; the one allowed update marks a normal transaction as reversed.
create function app_private.append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and tg_table_name = 'txns' then
    if old.status = 'normal' and new.status = 'reversed' and (to_jsonb(old) - 'status') = (to_jsonb(new) - 'status') then
      return new;
    end if;
  end if;
  raise exception '% rows cannot be changed or deleted', tg_table_name using errcode = '42501';
end
$$;
create trigger append_only before update or delete on public.txns for each row execute function app_private.append_only();
create trigger append_only before update or delete on public.txn_items for each row execute function app_private.append_only();
create trigger append_only before update or delete on public.stock_movements for each row execute function app_private.append_only();
create trigger append_only_truncate before truncate on public.txns for each statement execute function app_private.append_only();

-- Audit: before/after of every change; arguments name columns whose changes alone are not logged.
create function app_private.audit_row() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  if tg_op = 'UPDATE' and (v_old - tg_argv) = (v_new - tg_argv) then
    return null;
  end if;
  perform app_private.log(tg_table_name || '.' || lower(tg_op),
    tg_table_name || ':' || coalesce(v_row ->> 'id', v_row ->> 'student_no', v_row ->> 'key', v_row ->> 'user_id'),
    v_old, v_new);
  return null;
end
$$;
create trigger audit after insert or update or delete on public.profiles for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.user_roles for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.students for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.products for each row execute function app_private.audit_row('stock', 'updated_at');
create trigger audit after insert or update or delete on public.currency_issues for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.settings for each row execute function app_private.audit_row();

-- Row-level security ---------------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.students enable row level security;
alter table public.accounts enable row level security;
alter table public.txns enable row level security;
alter table public.products enable row level security;
alter table public.txn_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.currency_issues enable row level security;
alter table public.settings enable row level security;
alter table public.audit_log enable row level security;

grant select on public.profiles, public.user_roles, public.students, public.accounts, public.txns, public.products,
  public.txn_items, public.stock_movements, public.currency_issues, public.settings, public.audit_log to authenticated;

create policy read on public.profiles for select to authenticated using (
  id = auth.uid() or (select app_private.has_role('teacher')) or (select app_private.has_role('sysadmin')));

create policy read on public.user_roles for select to authenticated using (
  user_id = auth.uid() or (select app_private.has_role('teacher')) or (select app_private.has_role('sysadmin')));

create policy read on public.students for select to authenticated using (
  user_id = auth.uid() or (select app_private.has_role('teller'))
  or (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));

create policy read on public.accounts for select to authenticated using (
  student_no = (select app_private.my_student_no()) or (select app_private.has_role('teller'))
  or (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));

create policy read on public.txns for select to authenticated using (
  student_no = (select app_private.my_student_no())
  or ((select app_private.has_role('teller')) and operator_id = auth.uid()
      and app_private.cn_date(created_at) = app_private.cn_date(now()))
  or (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));

-- Visible exactly when the parent transaction is (the subquery is itself filtered by the policy above).
create policy read on public.txn_items for select to authenticated using (
  exists (select 1 from public.txns t where t.id = txn_id));

create policy read on public.products for select to authenticated using (
  listed or (select app_private.has_role('storekeeper'))
  or (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));

create policy read on public.stock_movements for select to authenticated using (
  (select app_private.has_role('storekeeper'))
  or (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));

create policy read on public.currency_issues for select to authenticated using (
  (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));

create policy read on public.settings for select to authenticated using (true);

create policy read on public.audit_log for select to authenticated using (
  (select app_private.has_role('teacher')) or (select app_private.has_role('sysadmin')));
