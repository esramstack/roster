create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text not null default '',
  role text not null default 'Staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null unique,
  room_count integer not null default 4 check (room_count between 1 and 10),
  lead text not null default '',
  config jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.daily_sessions(id) on delete cascade,
  case_key text not null,
  room_number integer not null,
  patient jsonb not null default '{}'::jsonb,
  assessment jsonb not null default '{}'::jsonb,
  pre_op jsonb not null default '{}'::jsonb,
  procedure jsonb not null default '{}'::jsonb,
  teams jsonb not null default '{}'::jsonb,
  post_op jsonb not null default '{}'::jsonb,
  start_time text not null default '',
  end_time text not null default '',
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, case_key),
  check (case_key ~ '^case[0-9]+$')
);

create table public.procedure_rooms (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.daily_sessions(id) on delete cascade,
  room_key text not null,
  room_number integer not null,
  patient jsonb not null default '{}'::jsonb,
  assignee text not null default '',
  procedure text not null default '',
  notes text not null default '',
  status text not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, room_key),
  check (room_key ~ '^pr[0-9]+$'),
  check (status in ('available', 'occupied', 'completed'))
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  session_id uuid references public.daily_sessions(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index cases_session_room_idx on public.cases(session_id, room_number);
create index cases_status_idx on public.cases(status);
create index procedure_rooms_session_room_idx on public.procedure_rooms(session_id, room_number);
create index audit_events_session_created_idx on public.audit_events(session_id, created_at desc);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger daily_sessions_set_updated_at
before update on public.daily_sessions
for each row execute function public.set_updated_at();

create trigger cases_set_updated_at
before update on public.cases
for each row execute function public.set_updated_at();

create trigger procedure_rooms_set_updated_at
before update on public.procedure_rooms
for each row execute function public.set_updated_at();

create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active = true
  );
$$;

alter table public.profiles enable row level security;
alter table public.daily_sessions enable row level security;
alter table public.cases enable row level security;
alter table public.procedure_rooms enable row level security;
alter table public.audit_events enable row level security;

create policy "profiles can read themselves"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "active users can read sessions"
on public.daily_sessions
for select
to authenticated
using (public.current_user_is_active());

create policy "active users can read cases"
on public.cases
for select
to authenticated
using (public.current_user_is_active());

create policy "active users can read procedure rooms"
on public.procedure_rooms
for select
to authenticated
using (public.current_user_is_active());

create policy "active users can read audit events"
on public.audit_events
for select
to authenticated
using (public.current_user_is_active());

-- Writes are performed by the Edge Function with the service role key.
-- Keeping write policies closed prevents accidental direct browser writes.
