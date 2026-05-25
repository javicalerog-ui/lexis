// =====================================================
// Runner: ejecuta un connector end-to-end.
//
// Pasos:
//   1. Carga adapter, credentials, estado
//   2. Crea row en connector_runs status=running
//   3. Llama a adapter.run() o adapter.handle_webhook()
//   4. Itera los items: cada uno pasa por ingest() del pipeline
//   5. Actualiza connector_runs y connectors.last_*
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdapter } from './registry';
import { ingest } from '@/lib/ingestion/pipeline';
import type {
  AdapterCredentials,
  AdapterContext,
  AdapterRunResult,
  ConnectorItem,
} from './types';

export interface RunOptions {
  trigger: 'cron' | 'manual' | 'webhook';
  webhook_payload?: unknown;
}

export interface RunSummary {
  run_id: string;
  status: 'success' | 'failed' | 'partial';
  items_fetched: number;
  items_new: number;
  items_skipped: number;
  items_failed: number;
  error_message?: string;
}

async function loadCredentials(
  supabase: SupabaseClient,
  credentials_id: string | null
): Promise<AdapterCredentials | null> {
  if (!credentials_id) return null;
  const { data } = await supabase
    .from('connector_credentials')
    .select('id, provider, access_token, refresh_token, expires_at, api_key, scopes')
    .eq('id', credentials_id)
    .maybeSingle();
  if (!data) return null;
  return data as AdapterCredentials;
}

export async function runConnector(
  supabase: SupabaseClient,
  connectorId: string,
  userId: string,
  options: RunOptions
): Promise<RunSummary> {
  // 1. Cargar connector
  const { data: connector } = await supabase
    .from('connectors')
    .select(
      'id, user_id, type, name, enabled, config, credentials_id, last_state'
    )
    .eq('id', connectorId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!connector) {
    throw new Error('Connector no encontrado');
  }
  if (!connector.enabled && options.trigger === 'cron') {
    throw new Error('Connector deshabilitado');
  }

  const adapter = getAdapter(connector.type);
  if (!adapter) {
    throw new Error(`Tipo de connector desconocido: ${connector.type}`);
  }

  // 2. Crear run record
  const { data: run, error: runErr } = await supabase
    .from('connector_runs')
    .insert({
      connector_id: connectorId,
      user_id: userId,
      trigger: options.trigger,
      status: 'running',
    })
    .select('id')
    .single();

  if (runErr || !run) {
    throw new Error(`No se pudo crear run: ${runErr?.message}`);
  }

  const runId = run.id;

  try {
    // 3. Cargar credenciales si las hay (refrescando si expiran)
    let credentials = await loadCredentials(supabase, connector.credentials_id);
    if (credentials) {
      const { refreshIfNeeded } = await import('@/lib/oauth/refresh');
      credentials = await refreshIfNeeded(supabase, credentials);
    }

    const ctx: AdapterContext = {
      config: (connector.config as Record<string, unknown>) ?? {},
      state: (connector.last_state as Record<string, unknown>) ?? {},
      credentials,
      supabase,
      user_id: userId,
      connector_id: connectorId,
    };

    // 4. Ejecutar adapter
    let result: AdapterRunResult;
    if (options.trigger === 'webhook') {
      if (!adapter.handle_webhook) {
        throw new Error('Este adapter no soporta webhooks');
      }
      result = await adapter.handle_webhook(options.webhook_payload, ctx);
    } else {
      if (!adapter.run) {
        throw new Error('Este adapter no soporta ejecución programada/manual');
      }
      result = await adapter.run(ctx);
    }

    // 5. Procesar items
    const fetched = result.items.length;
    let newCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const item of result.items) {
      try {
        // Dedup por external_id: buscar memoria con ese external_id en metadata
        if (item.external_id) {
          const { data: existing } = await supabase
            .from('memories')
            .select('id')
            .eq('user_id', userId)
            .eq('source_metadata->>external_id', item.external_id)
            .limit(1)
            .maybeSingle();
          if (existing) {
            skippedCount++;
            continue;
          }
        }

        const ingestResult = await ingest(supabase, userId, {
          source_type: item.source_type,
          raw_text: item.content,
          source_uri: item.source_uri,
          captured_at: item.captured_at,
          source_metadata: {
            origin: `connector_${connector.type}`,
            connector_id: connectorId,
            connector_name: connector.name,
            external_id: item.external_id,
            ...(item.extra_metadata || {}),
          },
        });
        newCount++;

        // Sprint 14: si es un evento de Google Calendar, upsert directo
        // en la tabla `events` para que aparezca en /feed y participe en
        // las reglas proactivas pre_meeting / followup. El extractor LLM
        // se saltó este item porque marca origin=connector_calendar.
        if (connector.type === 'calendar' && item.extra_metadata?.gcal_event_id) {
          await upsertCalendarEvent(
            supabase,
            userId,
            item,
            ingestResult.memory_id ?? null
          );
        }
      } catch (e) {
        failedCount++;
        console.error('connector item failed', e);
      }
    }

    // 6. Actualizar state y last_* del connector
    const status: RunSummary['status'] =
      failedCount === 0 ? 'success' : newCount === 0 ? 'failed' : 'partial';

    await supabase
      .from('connectors')
      .update({
        last_state: result.new_state,
        last_run_at: new Date().toISOString(),
        last_run_status: status,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', connectorId);

    await supabase
      .from('connector_runs')
      .update({
        status,
        completed_at: new Date().toISOString(),
        items_fetched: fetched,
        items_new: newCount,
        items_skipped: skippedCount,
        items_failed: failedCount,
        payload: result.debug ?? {},
      })
      .eq('id', runId);

    return {
      run_id: runId,
      status,
      items_fetched: fetched,
      items_new: newCount,
      items_skipped: skippedCount,
      items_failed: failedCount,
    };
  } catch (e) {
    const errMsg = String(e).slice(0, 500);

    await supabase
      .from('connectors')
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: 'failed',
        last_error: errMsg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', connectorId);

    await supabase
      .from('connector_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: errMsg,
      })
      .eq('id', runId);

    return {
      run_id: runId,
      status: 'failed',
      items_fetched: 0,
      items_new: 0,
      items_skipped: 0,
      items_failed: 0,
      error_message: errMsg,
    };
  }
}

// =====================================================
// Sprint 14: helper para poblar la tabla `events` desde un item del
// adapter Calendar. Se ejecuta DESPUÉS del ingest a memorias, así
// el `linked_memory_id` queda enlazado.
//
// Detecta el tipo desde los metadatos:
//   - all_day: si start es "date" en lugar de "dateTime"
//   - meeting si hay attendees externos (más de 1 participante distinto al user)
//   - reminder si está solo el user
//
// Idempotente: usa (external_event_id, external_calendar_id) como
// clave; si ya existe la row, hace update.
// =====================================================

async function upsertCalendarEvent(
  supabase: any,
  userId: string,
  item: any,
  linkedMemoryId: string | null
): Promise<void> {
  const m = item.extra_metadata || {};
  const eventId = m.gcal_event_id as string;
  const calendarId = m.gcal_calendar_id as string;
  if (!eventId || !calendarId) return;

  const status = m.gcal_status as string;
  if (status === 'cancelled') {
    // Si el evento fue cancelado en Google, marca la row local como cancelled
    await supabase
      .from('events')
      .update({ status: 'cancelled' })
      .eq('user_id', userId)
      .eq('external_event_id', eventId)
      .eq('external_calendar_id', calendarId);
    return;
  }

  const start = m.gcal_start || {};
  const end = m.gcal_end || {};
  const allDay = !!start.date;
  const dueAt = allDay
    ? `${start.date}T00:00:00Z`
    : start.dateTime
      ? new Date(start.dateTime).toISOString()
      : null;
  if (!dueAt) return;
  const endsAt = end.dateTime
    ? new Date(end.dateTime).toISOString()
    : end.date
      ? `${end.date}T00:00:00Z`
      : null;

  // Determinar type
  const attendees = (m.gcal_attendees || []) as Array<{
    email: string; self: boolean; response: string;
  }>;
  const externalAttendees = attendees.filter((a) => !a.self).length;
  const type = externalAttendees > 0 ? 'meeting' : 'reminder';

  // Title robust
  const titleLine = (item.content || '').split('\n')[0] || '(sin título)';
  const title = titleLine.replace(/^Evento:\s*/, '').slice(0, 240);

  // ¿Existe ya?
  const { data: existing } = await supabase
    .from('events')
    .select('id, status')
    .eq('user_id', userId)
    .eq('external_event_id', eventId)
    .eq('external_calendar_id', calendarId)
    .maybeSingle();

  const payload = {
    user_id: userId,
    due_at: dueAt,
    ends_at: endsAt,
    all_day: allDay,
    type,
    status: existing?.status === 'done' || existing?.status === 'cancelled'
      ? existing.status                         // respeta cambios manuales del user
      : 'pending',
    source: 'calendar' as const,
    title,
    description: m.gcal_location
      ? `📍 ${m.gcal_location}`
      : null,
    linked_memory_id: linkedMemoryId,
    external_event_id: eventId,
    external_calendar_id: calendarId,
    confidence: 1.0,
    metadata: {
      organizer: m.gcal_organizer,
      attendees: attendees.map((a) => a.email),
      html_link: m.gcal_html_link,
      has_video: m.gcal_has_video,
      calendar_summary: m.gcal_calendar_summary,
      recurring_event_id: m.gcal_recurring_event_id,
      created_by_lexis: m.gcal_created_by_lexis,
    },
  };

  if (existing) {
    await supabase
      .from('events')
      .update(payload)
      .eq('id', existing.id);
  } else {
    await supabase.from('events').insert(payload);
  }
}
