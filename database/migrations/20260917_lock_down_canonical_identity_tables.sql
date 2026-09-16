-- Canonical identity is accessed through Billing Store server code using the service role.
-- Never expose the users/staff_access tables directly to browser roles.
alter table public.users enable row level security;
alter table public.staff_access enable row level security;
revoke all on public.users from anon,authenticated;
revoke all on public.staff_access from anon,authenticated;
