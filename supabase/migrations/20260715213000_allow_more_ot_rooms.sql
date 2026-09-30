alter table public.daily_sessions
  drop constraint if exists daily_sessions_room_count_check;

alter table public.daily_sessions
  add constraint daily_sessions_room_count_check
  check (room_count between 1 and 99);
