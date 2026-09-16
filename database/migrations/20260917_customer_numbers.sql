-- Canonical Billing Store customer number used by License Master as customer_external_id.
create sequence if not exists public.customer_number_seq start with 100001;

alter table public.customers add column if not exists customer_number text;

with numbered as (
  select id, row_number() over(order by created_at nulls first, id) + 100000 as n
  from public.customers
  where customer_number is null
)
update public.customers c
set customer_number='CUST-'||lpad(numbered.n::text,6,'0')
from numbered
where c.id=numbered.id;

create unique index if not exists customers_customer_number_uidx on public.customers(customer_number);

create or replace function public.next_customer_number()
returns text language plpgsql as $$
begin
  return 'CUST-'||lpad(nextval('public.customer_number_seq')::text,6,'0');
end $$;

alter table public.customers alter column customer_number set default public.next_customer_number();

-- Keep the sequence ahead of any backfilled values.
select setval(
  'public.customer_number_seq',
  greatest(100000, coalesce((select max(replace(customer_number,'CUST-',''))::bigint from public.customers where customer_number like 'CUST-%'),100000)),
  true
);

comment on column public.customers.customer_number is 'Stable Billing Store customer number sent to OrbitFS License Master as customer_external_id.';
