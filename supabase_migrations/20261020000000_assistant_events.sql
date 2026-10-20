-- =====================================================
-- assistant_events — una fila por pregunta al asistente (/api/assistant)
--
-- Para saber, sin preguntar al usuario, si el asistente responde, cuánto
-- tarda y por qué falla (timeout / ocupado / interno). Solo lo escribe y lee
-- el service role; el código tolera que la tabla no exista.
-- NO guarda el texto de la pregunta ni de la respuesta.
-- =====================================================

create table if not exists public.assistant_events (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  kind        text not null,          -- registro | datos | memoria | foto | excluido | error
  code        text not null,          -- ok | busy | timeout | internal
  ms          integer,
  detail      text                    -- mensaje técnico recortado (solo errores)
);

create index if not exists assistant_events_user_created_idx
  on public.assistant_events (user_id, created_at desc);

alter table public.assistant_events enable row level security;

grant all on table public.assistant_events to service_role;
grant usage, select on sequence public.assistant_events_id_seq to service_role;
