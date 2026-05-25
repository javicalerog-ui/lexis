-- =====================================================
-- Sprint 16 · push_subscriptions
--
-- Suscripciones Web Push (VAPID) por dispositivo del usuario.
-- Cuando un user instala la PWA en un dispositivo y acepta
-- notificaciones, el navegador genera un objeto PushSubscription
-- que guardamos aquí. Después usamos web-push server-side para
-- enviarle pushes (Sprint 17 dispara, Sprint 16 entrega).
--
-- Una row por (user_id, endpoint). Endpoint es la URL que cada
-- proveedor push (FCM/Mozilla/Apple) entrega; identifica unívoca-
-- mente el dispositivo + browser.
-- =====================================================

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  keys jsonb not null,                                   -- { p256dh: '...', auth: '...' }
  user_agent text,                                       -- snapshot navegador/dispositivo
  label text,                                            -- nombre amable que el user puede poner ("iPhone Javi")
  last_used_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index idx_push_subs_user on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

create policy "push_subs_select_own" on push_subscriptions
  for select using (user_id = auth.uid());

create policy "push_subs_insert_own" on push_subscriptions
  for insert with check (user_id = auth.uid());

create policy "push_subs_update_own" on push_subscriptions
  for update using (user_id = auth.uid());

create policy "push_subs_delete_own" on push_subscriptions
  for delete using (user_id = auth.uid());
