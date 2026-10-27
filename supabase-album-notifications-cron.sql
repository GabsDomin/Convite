-- Agenda o envio dos avisos do álbum: a cada minuto o banco chama a API do convite,
-- que envia os avisos cujo horário já chegou.
-- A chave da chamada fica no Vault com o nome 'notifications_dispatch_secret' e deve ser a mesma
-- da variável NOTIFICATIONS_DISPATCH_SECRET na Vercel. Crie antes de rodar este script:
--   select vault.create_secret('<chave>', 'notifications_dispatch_secret');
-- Script reaplicável.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'album-notifications-dispatch';

select cron.schedule(
  'album-notifications-dispatch',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://gab-naia.online/api/notifications/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'notifications_dispatch_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  )
  where exists (
    select 1 from public.album_notifications where sent_at is null and send_at <= now()
  );
  $job$
);
