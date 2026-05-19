-- Mercado Pago Checkout Pro payment support.
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
  status text not null default 'pending',
  gateway text not null default 'mercado_pago',
  buyer_email text,
  message text,
  preference_id text,
  mercado_pago_payment_id text,
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
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_orders
  add column if not exists buyer_email text,
  add column if not exists message text,
  add column if not exists preference_id text,
  add column if not exists mercado_pago_payment_id text,
  add column if not exists approved_at timestamptz;

alter table public.payment_orders
  alter column gateway set default 'mercado_pago';

do $$
declare
  status_constraint text;
begin
  select conname
  into status_constraint
  from pg_constraint
  where conrelid = 'public.payment_orders'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%status%'
    and pg_get_constraintdef(oid) like '%pending%';

  if status_constraint is not null then
    execute format('alter table public.payment_orders drop constraint %I', status_constraint);
  end if;
end;
$$;

alter table public.payment_orders
  add constraint payment_orders_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled', 'error', 'paid'));

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
            and po.status in ('pending', 'approved', 'paid')
            and (po.status in ('approved', 'paid') or po.expires_at > now())
        )
      ) then 'reserved'
      else g.status
    end as status,
    g.sort_order
  from public.gifts g
  where g.status <> 'hidden'
  order by g.sort_order, g.name;
$$;

create or replace function public.create_mercadopago_order(
  p_gift_id text,
  p_buyer_name text,
  p_buyer_email text,
  p_message text default null,
  p_amount integer default null
)
returns table (
  id uuid,
  gift_id text,
  buyer_name text,
  buyer_email text,
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
  clean_name text := regexp_replace(trim(coalesce(p_buyer_name, '')), '\s+', ' ', 'g');
  clean_email text := lower(trim(coalesce(p_buyer_email, '')));
  selected_gift public.gifts%rowtype;
  final_amount integer;
begin
  if clean_name = '' then
    raise exception 'Nome obrigatório';
  end if;

  if clean_email <> '' and clean_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'E-mail inválido';
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
        and po.status in ('pending', 'approved', 'paid')
        and (po.status in ('approved', 'paid') or po.expires_at > now())
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

  insert into public.payment_orders (
    gift_id,
    guest_name,
    buyer_email,
    message,
    gift_name,
    gift_type,
    amount,
    gateway
  )
  values (
    selected_gift.id,
    clean_name,
    nullif(clean_email, ''),
    nullif(trim(coalesce(p_message, '')), ''),
    selected_gift.name,
    selected_gift.gift_type,
    final_amount,
    'mercado_pago'
  )
  returning
    payment_orders.id,
    payment_orders.gift_id,
    payment_orders.guest_name,
    payment_orders.buyer_email,
    payment_orders.gift_name,
    payment_orders.gift_type,
    payment_orders.amount,
    payment_orders.status,
    payment_orders.expires_at
  into id, gift_id, buyer_name, buyer_email, gift_name, gift_type, amount, status, expires_at;

  return next;
end;
$$;

create or replace function public.set_mercadopago_preference(
  p_order_id text,
  p_preference_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payment_orders
  set preference_id = p_preference_id
  where id = p_order_id::uuid;
end;
$$;

create or replace function public.confirm_mercadopago_payment(
  p_order_id text,
  p_payment_id text,
  p_status text,
  p_amount numeric default null,
  p_payment_method_id text default null,
  p_date_approved timestamptz default null,
  p_payer_email text default null,
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
  mapped_status text;
begin
  select *
  into selected_order
  from public.payment_orders
  where payment_orders.id = p_order_id::uuid;

  if selected_order.id is null then
    raise exception 'Pedido não encontrado';
  end if;

  if p_amount is not null and round(p_amount * 100) <> selected_order.amount * 100 then
    raise exception 'Valor divergente no pagamento';
  end if;

  mapped_status := case
    when p_status = 'approved' then 'approved'
    when p_status in ('pending', 'in_process', 'in_mediation') then 'pending'
    when p_status = 'rejected' then 'rejected'
    when p_status in ('cancelled', 'refunded', 'charged_back') then 'cancelled'
    else 'pending'
  end;

  update public.payment_orders
  set
    status = mapped_status,
    mercado_pago_payment_id = p_payment_id,
    amount_cents = case when p_amount is null then amount_cents else round(p_amount * 100)::integer end,
    paid_amount_cents = case when p_amount is null then paid_amount_cents else round(p_amount * 100)::integer end,
    capture_method = p_payment_method_id,
    buyer_email = coalesce(nullif(trim(coalesce(p_payer_email, '')), ''), buyer_email),
    webhook_payload = p_payload,
    approved_at = case when mapped_status = 'approved' then coalesce(p_date_approved, now()) else approved_at end,
    paid_at = case when mapped_status = 'approved' then coalesce(p_date_approved, now()) else paid_at end
  where payment_orders.id = selected_order.id;

  if mapped_status = 'approved' then
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

create or replace function public.mark_mercadopago_order_error(
  p_order_id text,
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
  where id = p_order_id::uuid
    and status = 'pending';
end;
$$;

grant execute on function public.get_public_gifts() to anon, authenticated;
grant execute on function public.create_mercadopago_order(text, text, text, text, integer) to anon, authenticated;
grant execute on function public.set_mercadopago_preference(text, text) to anon, authenticated;
grant execute on function public.confirm_mercadopago_payment(text, text, text, numeric, text, timestamptz, text, jsonb) to anon, authenticated;
grant execute on function public.mark_mercadopago_order_error(text, jsonb) to anon, authenticated;
