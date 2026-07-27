-- =====================================================
-- events · notified_at (disparo de recordatorios)
-- 2026-07-27
--
-- Marca cuándo se envió el push de aviso de un evento, para que el
-- cron de recordatorios (/api/cron/reminders) no re-notifique el mismo
-- evento en cada tick. NULL = aún no avisado.
-- =====================================================

alter table events add column if not exists notified_at timestamptz;

-- Índice para la consulta del cron: eventos pendientes sin avisar, por hora.
create index if not exists idx_events_reminder_due
  on events (due_at)
  where status = 'pending' and notified_at is null;
