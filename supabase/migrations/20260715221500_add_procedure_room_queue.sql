alter table public.procedure_rooms
  add column if not exists queue jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'procedure_rooms_queue_is_array'
  ) then
    alter table public.procedure_rooms
      add constraint procedure_rooms_queue_is_array
      check (jsonb_typeof(queue) = 'array');
  end if;
end $$;
