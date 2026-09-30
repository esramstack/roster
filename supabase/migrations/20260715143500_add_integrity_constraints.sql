do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cases_status_valid'
      and conrelid = 'public.cases'::regclass
  ) then
    alter table public.cases
      add constraint cases_status_valid
      check (status in ('scheduled', 'in-progress', 'completed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'daily_sessions_config_object'
      and conrelid = 'public.daily_sessions'::regclass
  ) then
    alter table public.daily_sessions
      add constraint daily_sessions_config_object
      check (jsonb_typeof(config) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'cases_json_columns_object'
      and conrelid = 'public.cases'::regclass
  ) then
    alter table public.cases
      add constraint cases_json_columns_object
      check (
        jsonb_typeof(patient) = 'object'
        and jsonb_typeof(assessment) = 'object'
        and jsonb_typeof(pre_op) = 'object'
        and jsonb_typeof(procedure) = 'object'
        and jsonb_typeof(teams) = 'object'
        and jsonb_typeof(post_op) = 'object'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'procedure_rooms_patient_object'
      and conrelid = 'public.procedure_rooms'::regclass
  ) then
    alter table public.procedure_rooms
      add constraint procedure_rooms_patient_object
      check (jsonb_typeof(patient) = 'object');
  end if;
end $$;
