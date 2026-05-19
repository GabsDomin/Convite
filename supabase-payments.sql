-- InfinitePay payment support.
-- Run after supabase-schema.sql and supabase-functions.sql.

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  gift_id text not null references public.gifts(id) on update cascade on delete restrict,
  guest_name text not null,
  normalized_guest_name text generated always as (
    lower(regexp_replace(trim(guest_name), '\s+', ' ', 'g'))
  ) stored,
  gift_name text not null,
  gift_type text not null check (gift_type in ('fixed', 'quota')),
  amount integer not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled', 'error')),
  gateway text not null default 'infinitepay',
  transaction_nsu text,
  receipt_url text,
  amount_cents integer,
  paid_amount_cents integer,
  installments integer,
  capture_method text,
  invoice_slug text,
  webhook_payload jsonb,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_orders_gift_status_idx
  on public.payment_orders (gift_id, status, expires_at);

drop trigger if exists set_payment_orders_updated_at on public.payment_orders;
create trigger set_payment_orders_updated_at
before update on public.payment_orders
for each row execute function public.set_updated_at();

alter table public.payment_orders enable row level security;

drop policy if exists "Payment orders are server managed" on public.payment_orders;
create policy "Payment orders are server managed"
on public.payment_orders for all
to anon, authenticated
using (false)
with check (false);

create or replace function public.get_public_gifts()
returns table (
  id text,
  name text,
  gift_type text,
  section text,
  category text,
  description text,
  value integer,
  goal integer,
  quota_options integer[],
  status text,
  sort_order integer
)
language sql
security definer
set search_path = public
as $$
  select
    g.id,
    g.name,
    g.gift_type,
    g.section,
    g.category,
    g.description,
    g.value,
    g.goal,
    g.quota_options,
    case
      when g.gift_type = 'fixed' and (
        exists (
          select 1
          from public.gift_reservations gr
          where gr.gift_id = g.id
            and gr.gift_type = 'fixed'
        )
        or exists (
          select 1
          from public.payment_orders po
          where po.gift_id = g.id
            and po.gift_type = 'fixed'
            and po.status in ('pending', 'paid')
            and (po.status = 'paid' or po.expires_at > now())
        )
      ) then 'reserved'
      else g.status
    end as status,
    g.sort_order
  from public.gifts g
  where g.status <> 'hidden'
  order by g.sort_order, g.name;
$$;

create or replace function public.create_infinitepay_order(
  p_gift_id text,
  p_guest_name text,
  p_amount integer default null
)
returns table (
  id uuid,
  gift_id text,
  guest_name text,
  gift_name text,
  gift_type text,
  amount integer,
  status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := regexp_replace(trim(coalesce(p_guest_name, '')), '\s+', ' ', 'g');
  selected_gift public.gifts%rowtype;
  final_amount integer;
begin
  if clean_name = '' then
    raise exception 'Nome obrigatório';
  end if;

  select *
  into selected_gift
  from public.gifts
  where gifts.id = p_gift_id
    and gifts.status <> 'hidden';

  if selected_gift.id is null then
    raise exception 'Presente não encontrado';
  end if;

  if selected_gift.gift_type = 'fixed' then
    if exists (
      select 1
      from public.gift_reservations gr
      where gr.gift_id = selected_gift.id
        and gr.gift_type = 'fixed'
    ) or exists (
      select 1
      from public.payment_orders po
      where po.gift_id = selected_gift.id
        and po.gift_type = 'fixed'
        and po.status in ('pending', 'paid')
        and (po.status = 'paid' or po.expires_at > now())
    ) then
      raise exception 'Esse presente já foi escolhido';
    end if;

    final_amount := selected_gift.value;
  else
    final_amount := p_amount;

    if final_amount is null or not (final_amount = any(selected_gift.quota_options)) then
      raise exception 'Valor da cota inválido';
    end if;
  end if;

  insert into public.payment_orders (gift_id, guest_name, gift_name, gift_type, amount)
  values (selected_gift.id, clean_name, selected_gift.name, selected_gift.gift_type, final_amount)
  returning
    payment_orders.id,
    payment_orders.gift_id,
    payment_orders.guest_name,
    payment_orders.gift_name,
    payment_orders.gift_type,
    payment_orders.amount,
    payment_orders.status,
    payment_orders.expires_at
  into id, gift_id, guest_name, gift_name, gift_type, amount, status, expires_at;

  return next;
end;
$$;

create or replace function public.confirm_infinitepay_payment(
  p_order_nsu text,
  p_transaction_nsu text default null,
  p_receipt_url text default null,
  p_amount integer default null,
  p_paid_amount integer default null,
  p_installments integer default null,
  p_capture_method text default null,
  p_invoice_slug text default null,
  p_payload jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  gift_id text,
  gift_name text,
  gift_type text,
  amount integer,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_order public.payment_orders%rowtype;
  expected_amount integer;
begin
  select *
  into selected_order
  from public.payment_orders
  where payment_orders.id = p_order_nsu::uuid;

  if selected_order.id is null then
    raise exception 'Pedido não encontrado';
  end if;

  expected_amount := selected_order.amount * 100;

  if p_amount is not null and p_amount <> expected_amount then
    raise exception 'Valor divergente no pagamento';
  end if;

  if selected_order.status <> 'paid' then
    update public.payment_orders
    set
      status = 'paid',
      transaction_nsu = p_transaction_nsu,
      receipt_url = p_receipt_url,
      amount_cents = p_amount,
      paid_amount_cents = p_paid_amount,
      installments = p_installments,
      capture_method = p_capture_method,
      invoice_slug = p_invoice_slug,
      webhook_payload = p_payload,
      paid_at = now()
    where payment_orders.id = selected_order.id;

    insert into public.gift_reservations (gift_id, guest_name, gift_name, gift_type, amount)
    values (
      selected_order.gift_id,
      selected_order.guest_name,
      selected_order.gift_name,
      selected_order.gift_type,
      selected_order.amount
    )
    on conflict do nothing;
  end if;

  return query
    select
      po.id,
      po.gift_id,
      po.gift_name,
      po.gift_type,
      po.amount,
      po.status
    from public.payment_orders po
    where po.id = selected_order.id;
end;
$$;

create or replace function public.mark_infinitepay_order_error(
  p_order_nsu text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payment_orders
  set
    status = 'error',
    webhook_payload = p_payload
  where id = p_order_nsu::uuid
    and status = 'pending';
end;
$$;

grant execute on function public.get_public_gifts() to anon, authenticated;
grant execute on function public.create_infinitepay_order(text, text, integer) to anon, authenticated;
grant execute on function public.confirm_infinitepay_payment(text, text, text, integer, integer, integer, text, text, jsonb) to anon, authenticated;
grant execute on function public.mark_infinitepay_order_error(text, jsonb) to anon, authenticated;
