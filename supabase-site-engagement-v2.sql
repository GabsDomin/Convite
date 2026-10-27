-- Engajamento: modal de presente + gift_id opcional

alter table public.site_engagement_events
  add column if not exists gift_id text;

alter table public.site_engagement_events
  drop constraint if exists site_engagement_events_event_type_check;

alter table public.site_engagement_events
  add constraint site_engagement_events_event_type_check
  check (event_type in ('gifts_area_view', 'gifts_list_opened', 'gift_modal_opened'));
