-- DPRO WELFARE_SHUTTLE R2 remediation
-- Applied to Supabase project cbknucemarcpbscirzyv on 2026-08-25.
-- Adds server-side staff session revocation/current-authority support and 0081 phone normalization.

create table if not exists public.shuttle_staff_sessions (
  id uuid primary key,
  facility_id uuid not null references public.shuttle_facilities(id) on delete cascade,
  staff_id uuid not null references public.shuttle_staff(id) on delete cascade,
  role text not null check (role in ('admin','dispatcher','driver','attendant','reception')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now(),
  constraint shuttle_staff_sessions_expiry_check check (expires_at > issued_at)
);

create index if not exists idx_shuttle_staff_sessions_staff_active
  on public.shuttle_staff_sessions (facility_id, staff_id, expires_at)
  where revoked_at is null;
create index if not exists idx_shuttle_staff_sessions_expiry
  on public.shuttle_staff_sessions (expires_at);

alter table public.shuttle_staff_sessions enable row level security;

create or replace function public.shuttle_normalize_phone(p_phone text)
returns text
language plpgsql
immutable
as $function$
declare
  v_ascii text;
  v_digits text;
begin
  if p_phone is null or btrim(p_phone) = '' then
    return null;
  end if;

  v_ascii := translate(p_phone, '０１２３４５６７８９', '0123456789');
  v_digits := regexp_replace(v_ascii, '[^0-9]', '', 'g');

  if v_digits ~ '^0081[1-9][0-9]{8,9}$' then
    v_digits := '0' || substr(v_digits, 5);
  elsif v_digits ~ '^81[1-9][0-9]{8,9}$' then
    v_digits := '0' || substr(v_digits, 3);
  end if;

  if v_digits = '' then
    return null;
  end if;
  return v_digits;
end;
$function$;

insert into public.shuttle_schema_versions(component, version, applied_at)
values ('database', 'SHUTTLE-R2-DB-20260825', now())
on conflict (component) do update
set version = excluded.version,
    applied_at = excluded.applied_at;

create or replace function public.shuttle_schema_check()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_required_tables text[] := array[
    'shuttle_facilities',
    'shuttle_settings',
    'shuttle_closed_dates',
    'shuttle_riders',
    'shuttle_guardians',
    'shuttle_guardian_rider_links',
    'shuttle_staff',
    'shuttle_staff_sessions',
    'shuttle_vehicles',
    'shuttle_locations',
    'shuttle_regular_schedules',
    'shuttle_runs',
    'shuttle_run_staff',
    'shuttle_stops',
    'shuttle_change_requests',
    'shuttle_ride_events',
    'shuttle_notifications',
    'shuttle_incidents',
    'shuttle_idempotency_keys',
    'shuttle_audit_logs',
    'shuttle_schema_versions'
  ];
  v_missing_tables text[];
  v_required_rpcs text[] := array[
    'public.shuttle_generate_daily_runs(uuid,date,uuid)',
    'public.shuttle_register_ride_event(uuid,text,uuid,text,timestamp with time zone,text)',
    'public.shuttle_admin_correct_stop_status(uuid,text,uuid,text)',
    'public.shuttle_assert_demo_facility(uuid)',
    'public.shuttle_schema_check()'
  ];
  v_missing_rpcs text[];
  v_rls_disabled text[];
  v_version text;
  v_constraint_count integer;
  v_index_count integer;
begin
  select array_agg(required_name order by required_name)
    into v_missing_tables
    from unnest(v_required_tables) as required_name
   where to_regclass('public.' || required_name) is null;

  select array_agg(required_rpc order by required_rpc)
    into v_missing_rpcs
    from unnest(v_required_rpcs) as required_rpc
   where to_regprocedure(required_rpc) is null;

  select array_agg(c.relname order by c.relname)
    into v_rls_disabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = any(v_required_tables)
     and c.relkind = 'r'
     and not c.relrowsecurity;

  select version
    into v_version
    from public.shuttle_schema_versions
   where component = 'database';

  select count(*)
    into v_constraint_count
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = any(v_required_tables);

  select count(*)
    into v_index_count
    from pg_indexes
   where schemaname = 'public'
     and tablename = any(v_required_tables);

  return jsonb_build_object(
    'ok',
      coalesce(array_length(v_missing_tables, 1), 0) = 0
      and coalesce(array_length(v_missing_rpcs, 1), 0) = 0
      and coalesce(array_length(v_rls_disabled, 1), 0) = 0
      and v_version is not null,
    'service', 'DPRO Welfare Shuttle Database',
    'version', v_version,
    'timezone', 'Asia/Tokyo',
    'required_table_count', array_length(v_required_tables, 1),
    'missing_tables', coalesce(to_jsonb(v_missing_tables), '[]'::jsonb),
    'required_rpc_count', array_length(v_required_rpcs, 1),
    'missing_rpcs', coalesce(to_jsonb(v_missing_rpcs), '[]'::jsonb),
    'rls_disabled_tables', coalesce(to_jsonb(v_rls_disabled), '[]'::jsonb),
    'constraint_count', v_constraint_count,
    'index_count', v_index_count,
    'checked_at', now()
  );
end;
$function$;
