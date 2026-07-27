-- =====================================================
-- ACTA · Consolidación en el Supabase de Lexis
-- 2026-07-23 · Plan: 11-acta-grabador-reuniones/docs/PLAN-CONSOLIDACION-LEXIS.md
--
-- Crea las tablas del grabador de reuniones (Acta) DENTRO de la BD de
-- Lexis, con prefijo acta_ para no chocar con las tablas existentes
-- (user_settings y push_subscriptions ya existen en Lexis).
--
-- Diferencias deliberadas respecto al bundle original de Acta:
--   - Prefijo acta_ en tablas, índices, triggers y policies.
--   - Función de trigger propia acta_set_updated_at() (no se toca
--     ninguna función de Lexis).
--   - NO se crea push_subscriptions: se comparte la tabla de Lexis
--     (misma estructura) y el par VAPID de Lexis.
--   - NO se portan jobs ni claim_next_job (DEPRECATED desde 2026-07-05,
--     sustituidos por Cloudflare Workflows).
--   - Bucket de audio: acta-audio (privado), no 'audio'.
--   - Idempotente: re-ejecutable sin error.
-- =====================================================

create extension if not exists pgcrypto;

-- ---------- updated_at automático (función propia de Acta) ----------
create or replace function acta_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- =====================================================
-- acta_recordings — una grabación (reunión)
-- =====================================================
create table if not exists acta_recordings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text,
  template_key  text not null default 'reunion_interna',
  language      text not null default 'es',          -- 'es' | 'en' | 'auto'
  status        text not null default 'recording'
                check (status in ('recording','uploaded','transcribing',
                                  'extracting','review','synced','failed')),
  mime_type     text,                                 -- audio/mp4 (iOS) | audio/webm (Android)
  duration_s    integer,
  chunk_count   integer not null default 0,
  started_at    timestamptz not null default now(),
  finalized_at  timestamptz,
  audio_path    text,
  audio_purged_at timestamptz,                        -- audio ya borrado por retención
  retention_until timestamptz,                        -- borrado de audio programado
  audio_sessions jsonb not null default '[]'::jsonb,  -- rutas de audio por sesión
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists acta_recordings_user_created on acta_recordings (user_id, created_at desc);
create index if not exists acta_recordings_status on acta_recordings (status);
drop trigger if exists trg_acta_recordings_updated on acta_recordings;
create trigger trg_acta_recordings_updated before update on acta_recordings
  for each row execute function acta_set_updated_at();

-- =====================================================
-- acta_recording_chunks — trozos de audio subidos progresivamente
-- seq GLOBAL y monótono; session = metadato de agrupación (~20 min)
-- =====================================================
create table if not exists acta_recording_chunks (
  id            uuid primary key default gen_random_uuid(),
  recording_id  uuid not null references acta_recordings(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  seq           integer not null,
  session       integer not null default 0,
  storage_path  text not null,                        -- {user_id}/{recording_id}/s{session}/{seq}.{ext}
  size_bytes    integer,
  uploaded_at   timestamptz not null default now(),
  unique (recording_id, seq)
);
create index if not exists acta_chunks_recording on acta_recording_chunks (recording_id, seq);
create index if not exists acta_chunks_recording_session
  on acta_recording_chunks (recording_id, session, seq);

-- =====================================================
-- acta_transcripts — resultado de transcripción
-- =====================================================
create table if not exists acta_transcripts (
  recording_id  uuid primary key references acta_recordings(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null,                        -- 'groq' | 'openai' | 'local'
  model         text not null,
  language      text,
  text          text not null,
  segments      jsonb not null default '[]',          -- [{start,end,text}]
  processing_ms integer,
  created_at    timestamptz not null default now()
);

-- =====================================================
-- acta_briefs — extracción estructurada según plantilla
-- =====================================================
create table if not exists acta_briefs (
  id            uuid primary key default gen_random_uuid(),
  recording_id  uuid not null references acta_recordings(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  template_key  text not null,
  payload       jsonb not null,
  summary_md    text not null,                        -- lo que viaja al sink (Lexis)
  confidence    real,
  model_used    text,
  status        text not null default 'draft'
                check (status in ('draft','approved','synced','failed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (recording_id)
);
create index if not exists acta_briefs_user_status on acta_briefs (user_id, status);
drop trigger if exists trg_acta_briefs_updated on acta_briefs;
create trigger trg_acta_briefs_updated before update on acta_briefs
  for each row execute function acta_set_updated_at();

-- =====================================================
-- acta_sink_deliveries — entregas a destinos. Solo service role.
-- =====================================================
create table if not exists acta_sink_deliveries (
  id            uuid primary key default gen_random_uuid(),
  brief_id      uuid not null references acta_briefs(id) on delete cascade,
  user_id       uuid not null,
  sink          text not null,                        -- 'lexis'
  status        text not null default 'pending'
                check (status in ('pending','delivered','failed')),
  attempts      integer not null default 0,
  response      jsonb,
  last_error    text,
  delivered_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (brief_id, sink)
);

-- =====================================================
-- acta_settings — preferencias del grabador
-- (separada de user_settings de Lexis, que ya existe)
-- =====================================================
create table if not exists acta_settings (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  default_template text not null default 'reunion_interna',
  default_language text not null default 'es',
  auto_approve     boolean not null default false,
  retention_days   integer not null default 30,
  push_enabled     boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
drop trigger if exists trg_acta_settings_updated on acta_settings;
create trigger trg_acta_settings_updated before update on acta_settings
  for each row execute function acta_set_updated_at();

-- =====================================================
-- RLS
-- =====================================================
alter table acta_recordings       enable row level security;
alter table acta_recording_chunks enable row level security;
alter table acta_transcripts      enable row level security;
alter table acta_briefs           enable row level security;
alter table acta_sink_deliveries  enable row level security;  -- sin policies: solo service
alter table acta_settings         enable row level security;

drop policy if exists "own acta recordings" on acta_recordings;
create policy "own acta recordings" on acta_recordings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own acta chunks" on acta_recording_chunks;
create policy "own acta chunks" on acta_recording_chunks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own acta transcripts read" on acta_transcripts;
create policy "own acta transcripts read" on acta_transcripts
  for select using (auth.uid() = user_id);

drop policy if exists "own acta briefs read" on acta_briefs;
create policy "own acta briefs read" on acta_briefs
  for select using (auth.uid() = user_id);
-- Escritura de transcripts/briefs: solo backend (service role).
-- La edición del brief por el usuario pasa por la API (PATCH /briefs).

drop policy if exists "own acta settings" on acta_settings;
create policy "own acta settings" on acta_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================
-- Storage: bucket privado de audio de Acta
-- Path obligatorio: {user_id}/{recording_id}/s{session}/{seq}.{ext}
-- =====================================================
insert into storage.buckets (id, name, public)
values ('acta-audio', 'acta-audio', false)
on conflict (id) do nothing;

drop policy if exists "acta-audio insert own folder" on storage.objects;
create policy "acta-audio insert own folder" on storage.objects
  for insert with check (
    bucket_id = 'acta-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "acta-audio read own folder" on storage.objects;
create policy "acta-audio read own folder" on storage.objects
  for select using (
    bucket_id = 'acta-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "acta-audio delete own folder" on storage.objects;
create policy "acta-audio delete own folder" on storage.objects
  for delete using (
    bucket_id = 'acta-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
