-- Security advisor fixes (no behaviour change).
-- 1. Pin search_path on the updated_at trigger function.
alter function public.set_updated_at() set search_path = public;

-- 2. current_user_is_active() is only needed by RLS policies for signed-in users.
--    Stop anonymous callers reaching it through /rest/v1/rpc.
revoke execute on function public.current_user_is_active() from public, anon;
grant execute on function public.current_user_is_active() to authenticated;
