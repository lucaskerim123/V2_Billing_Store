-- Extend existing permission-checked staff support context; do not relax profile RLS.
CREATE OR REPLACE FUNCTION public.support_ticket_billing_context(p_ticket_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t public.support_tickets%rowtype; o jsonb; items jsonb; invs jsonb; customer_info jsonb;
begin
 if not public.has_permission('support.manage') then raise exception 'permission denied: support.manage'; end if;
 if not public.support_staff_can_access_ticket(p_ticket_id,auth.uid()) then raise exception 'ticket is outside your support department or escalation level'; end if;
 select * into t from public.support_tickets where id=p_ticket_id; if not found then raise exception 'ticket not found'; end if;
 if t.related_order_id is not null then select to_jsonb(x) into o from (select id,order_number,status,payment_status,fulfillment_status,total_cents,currency,created_at from public.orders where id=t.related_order_id and auth_user_id=t.user_id) x; select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into items from (select id,product_id,product_name,license_product_key,quantity,unit_price_cents,total_cents,service_status,billing_period,next_due_at from public.order_items where order_id=t.related_order_id order by product_name) x; else o=null; items='[]'::jsonb; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into invs from (select id,invoice_number,order_id,status,subtotal_cents,discount_cents,total_cents,paid_cents,currency,due_at,created_at from public.invoices where auth_user_id=t.user_id and (t.related_order_id is null or order_id=t.related_order_id) order by created_at desc limit 30) x;
 select to_jsonb(x) into customer_info from (
   select coalesce(nullif(trim(concat_ws(' ',nullif(btrim(p.first_name),''),nullif(btrim(p.last_name),''))),''),nullif(btrim(p.display_name),''),nullif(btrim(c.display_name),''),nullif(btrim(c.name),''),'Customer') display_name,
     coalesce(nullif(btrim(p.first_name),''),nullif(btrim(c.first_name),''),'') first_name,
     coalesce(nullif(btrim(p.last_name),''),nullif(btrim(c.last_name),''),'') last_name,
     p.company_name,p.phone,p.created_at,p.role,p.status
   from public.support_tickets st
   left join public.user_profiles p on p.id=st.user_id
   left join public.customers c on c.user_id=st.user_id
   where st.id=p_ticket_id
   limit 1
 ) x;
 return jsonb_build_object('order',o,'items',items,'invoices',invs,'customer',customer_info);
end $function$;
