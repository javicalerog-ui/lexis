-- =====================================================
-- Sprint 14 · user_settings
--
-- Tabla de preferencias del usuario que es infraestructura
-- transversal para Sprints 14-18:
--   - timezone: zona horaria del usuario (Europe/Madrid default).
--               Todos los crons consultan esto antes de "¿toca disparar?".
--   - quiet_hours_*: ventana de silencio para push notifications.
--   - draft_calendar_id: ID del calendario "Lexis · Borradores" en
--                        Google Calendar que se autocreará al primer
--                        uso de write. Si write_to_primary=true, se
--                        ignora y los eventos van al primario.
--
-- Una fila por usuario, creada lazy en el primer acceso.
-- =====================================================

create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Europe/Madrid',
  preferred_language text not null default 'es',

  -- Push / silencio nocturno
  quiet_hours_start text not null default '22:00',     -- HH:MM en zona del usuario
  quiet_hours_end   text not null default '08:00',
  quiet_hours_enabled boolean not null default true,

  -- Calendar
  draft_calendar_id text,                              -- google calendar id (cuando se crea "Lexis · Borradores")
  write_to_primary boolean not null default false,     -- si true, las escrituras van directas a primary

  -- Push notifications globales
  push_enabled boolean not null default true,
  push_types_enabled jsonb not null default '{"deadlines":true,"meetings":true,"follow_ups":true,"reminders":true,"reviews":true}'::jsonb,
  push_offsets_minutes int[] not null default array[1440, 60, 15],  -- 24h, 1h, 15min antes

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

create policy "user_settings_select_own" on user_settings
  for select using (user_id = auth.uid());

create policy "user_settings_insert_own" on user_settings
  for insert with check (user_id = auth.uid());

create policy "user_settings_update_own" on user_settings
  for update using (user_id = auth.uid());

-- Trigger updated_at
create or replace function tg_user_settings_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end
$$;

create trigger tg_user_settings_updated_at
  before update on user_settings
  for each row execute function tg_user_settings_updated_at();
