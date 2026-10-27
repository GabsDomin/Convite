-- Avisos do álbum: inscrições de push do navegador e a fila de avisos.
-- - push_subscriptions: aparelhos que aceitaram receber avisos (guest_key vazio = sem nome conhecido).
-- - album_notifications: avisos para todos (audience 'all') ou para um convidado (audience 'guest');
--   o servidor envia os que já passaram de send_at e ainda não foram enviados (sent_at nulo).
--   Os avisos enviados também aparecem dentro do álbum, para quem não tem push (ex.: iPhone sem instalar).
-- O agendamento (chamar o envio a cada minuto) fica em supabase-album-notifications-cron.sql.
-- Script reaplicável.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique check (endpoint ~ '^https?://'),
  p256dh text not null,
  auth text not null,
  guest_key text,
  guest_name text,
  user_agent text,
  failure_count integer not null default 0,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_guest_idx
  on public.push_subscriptions (guest_key) where disabled_at is null;

create table if not exists public.album_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 2 and 80),
  body text not null check (char_length(trim(body)) between 2 and 240),
  url text not null default '/album' check (url ~ '^/'),
  audience text not null default 'all' check (audience in ('all', 'guest')),
  guest_key text,
  kind text not null default 'manual' check (kind in ('manual', 'album_open', 'new_challenge')),
  send_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now(),
  check (audience = 'all' or guest_key is not null)
);

create index if not exists album_notifications_pending_idx
  on public.album_notifications (send_at) where sent_at is null;
create index if not exists album_notifications_sent_idx
  on public.album_notifications (sent_at desc) where sent_at is not null;

alter table public.push_subscriptions enable row level security;
alter table public.album_notifications enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;
revoke all on table public.album_notifications from anon, authenticated;
grant all on table public.push_subscriptions to service_role;
grant all on table public.album_notifications to service_role;

-- Aviso automático da abertura do álbum (28/11, 15h de Brasília).
insert into public.album_notifications (title, body, url, audience, kind, send_at)
select 'O álbum abriu! 📸', 'Seus 3 desafios já estão esperando. Toque para começar a registrar o nosso dia.', '/album', 'all', 'album_open',
  '2026-11-28 15:00:00-03'
where not exists (select 1 from public.album_notifications where kind = 'album_open');
