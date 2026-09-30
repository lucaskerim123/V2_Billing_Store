-- Repair missing automatic ticket numbers without changing existing ticket identifiers.
-- Forward-only migration: applies to customer, guest, and staff ticket creation paths.
do $$
declare
  column_type text;
  column_default text;
  sequence_name text;
  highest_ticket bigint;
  seq_last bigint;
begin
  if to_regclass('public.support_tickets') is null then
    raise exception 'support_tickets does not exist; apply the base support schema first';
  end if;

  select format_type(a.atttypid, a.atttypmod),
         pg_get_expr(d.adbin, d.adrelid)
    into column_type, column_default
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.support_tickets'::regclass
     and a.attname = 'ticket_number'
     and not a.attisdropped;

  if column_type is null then
    raise exception 'support_tickets.ticket_number is missing';
  end if;
  if column_type not in ('bigint', 'integer') then
    raise exception 'Unexpected support_tickets.ticket_number type: %', column_type;
  end if;

  -- Keep any existing numbering scheme if the column already has a default.
  if column_default is not null then
    raise notice 'Existing ticket number default preserved: %', column_default;
    return;
  end if;

  -- Block concurrent inserts only during the short counter repair.
  lock table public.support_tickets in access exclusive mode;
  -- Recheck after obtaining the lock (another migration may have fixed it).
  select pg_get_expr(d.adbin, d.adrelid)
    into column_default
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.support_tickets'::regclass
     and a.attname = 'ticket_number';
  if column_default is not null then
    return;
  end if;

  sequence_name := pg_get_serial_sequence('public.support_tickets', 'ticket_number');
  if sequence_name is null then
    create sequence if not exists public.support_ticket_number_repair_seq as bigint;
    sequence_name := 'public.support_ticket_number_repair_seq';
    alter sequence public.support_ticket_number_repair_seq
      owned by public.support_tickets.ticket_number;
  end if;

  select coalesce(max(ticket_number), 0)
    into highest_ticket from public.support_tickets;
  -- Never move a pre-existing sequence backwards.
  execute format('select last_value from %s', sequence_name) into seq_last;
  perform setval(sequence_name::regclass,
                 greatest(highest_ticket, seq_last, 1),
                 greatest(highest_ticket, seq_last) > 0);

  execute format(
    'alter table public.support_tickets alter column ticket_number set default nextval(%L::regclass)',
    sequence_name
  );
end $$;

-- Ticket numbers must remain unique if an existing constraint already provides it.
-- No existing numbers or support records are rewritten.
