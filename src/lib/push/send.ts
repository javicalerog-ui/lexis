// =====================================================
// lib/push/send.ts
//
// Helper server-side para enviar Web Push notifications a un usuario.
// Maneja:
//   - Carga de todas sus subscriptions activas.
//   - Envío vía web-push con sus VAPID keys.
//   - Quiet hours (no envía si está dentro de la ventana de silencio).
//   - Cleanup de subscriptions expiradas (410/404 → delete).
//
// Sprint 16.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { loadUserSettings, isQuietHourNow } from '@/lib/time/userTime';

let vapidConfigured = false;

function configureVapid() {
  if (vapidConfigured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:lexis@example.com';
  if (!pub || !priv) {
    throw new Error('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no configurados');
  }
  webpush.setVapidDetails(subject, pub, priv);
  vapidConfigured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;                                          // ruta interna a abrir al click
  tag?: string;                                          // agrupar/coalescer
  icon?: string;                                         // override icono
  badge?: string;
  actions?: Array<{ action: string; title: string }>;    // quick replies del notification API
  data?: Record<string, unknown>;                        // metadata para el SW
  silent?: boolean;
  require_interaction?: boolean;
}

export interface SendPushOptions {
  ignore_quiet_hours?: boolean;                          // para tests / errores críticos
  type_key?: string;                                     // 'deadlines'|'meetings'|'follow_ups'|'reminders'|'reviews'
}

export interface SendPushResult {
  sent: number;
  failed: number;
  skipped_quiet_hours: boolean;
  skipped_type_disabled: boolean;
  detail: Array<{ subscription_id: string; ok: boolean; error?: string }>;
}

/**
 * Envía un push a TODAS las subscriptions activas del user.
 * Respeta quiet_hours y types disabled del user_settings.
 */
export async function sendPush(
  supabase: SupabaseClient,
  userId: string,
  payload: PushPayload,
  options: SendPushOptions = {}
): Promise<SendPushResult> {
  configureVapid();

  const settings = await loadUserSettings(supabase, userId);

  // Globalmente deshabilitado
  if (!settings.push_enabled) {
    return {
      sent: 0, failed: 0,
      skipped_quiet_hours: false,
      skipped_type_disabled: false,
      detail: [],
    };
  }

  // Tipo deshabilitado
  if (options.type_key && settings.push_types_enabled[options.type_key] === false) {
    return {
      sent: 0, failed: 0,
      skipped_quiet_hours: false,
      skipped_type_disabled: true,
      detail: [],
    };
  }

  // Quiet hours
  if (!options.ignore_quiet_hours && isQuietHourNow(settings)) {
    return {
      sent: 0, failed: 0,
      skipped_quiet_hours: true,
      skipped_type_disabled: false,
      detail: [],
    };
  }

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, keys')
    .eq('user_id', userId);

  if (!subs || subs.length === 0) {
    return {
      sent: 0, failed: 0,
      skipped_quiet_hours: false,
      skipped_type_disabled: false,
      detail: [],
    };
  }

  const payloadStr = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const detail: SendPushResult['detail'] = [];

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: sub.keys as { p256dh: string; auth: string },
        },
        payloadStr,
        { TTL: 3600 }                                       // expira en 1h si no se entrega
      );
      sent++;
      detail.push({ subscription_id: sub.id, ok: true });
      // Update last_used_at
      await supabase
        .from('push_subscriptions')
        .update({ last_used_at: new Date().toISOString(), last_error: null })
        .eq('id', sub.id);
    } catch (e: any) {
      failed++;
      const statusCode = e.statusCode;
      detail.push({
        subscription_id: sub.id,
        ok: false,
        error: `${statusCode}: ${String(e.body || e.message).slice(0, 120)}`,
      });

      // 404 / 410 = subscription muerta, la borramos
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      } else {
        await supabase
          .from('push_subscriptions')
          .update({
            last_error: `${statusCode}: ${String(e.body || e.message).slice(0, 200)}`,
            last_error_at: new Date().toISOString(),
          })
          .eq('id', sub.id);
      }
    }
  }

  return {
    sent, failed,
    skipped_quiet_hours: false,
    skipped_type_disabled: false,
    detail,
  };
}
