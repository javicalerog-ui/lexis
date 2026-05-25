// =====================================================
// lib/proactive/presets.ts
//
// Definición canónica de las 5 reglas preset que Lexis sugiere
// automáticamente al user la primera vez que abre
// /settings/proactive-rules.
//
// Crear es idempotente: si la preset_key ya existe, se respeta su
// estado enabled. Si no existe, se crea con `enabled: true`.
//
// Cualquier cambio aquí afecta solo a nuevas creaciones, no a las
// reglas ya persistidas (el user es dueño de su copia).
//
// Sprint 17.
// =====================================================

export interface PresetDefinition {
  preset_key: string;
  name: string;
  description: string;
  trigger_type: 'cron' | 'event';
  trigger_config: Record<string, unknown>;
  action_type: string;
  action_payload: Record<string, unknown>;
  schedule_human: string;     // texto amigable para mostrar en la UI
}

export const PRESETS: PresetDefinition[] = [
  {
    preset_key: 'outlook_capture_weekly',
    name: 'Captura semanal de Outlook',
    description:
      'Cada lunes a primera hora te recuerdo sacarle una foto a tu vista semanal de Outlook para que Lexis incorpore los eventos a tu agenda.',
    trigger_type: 'cron',
    trigger_config: { cron: '30 7 * * 1' },                  // lunes 7:30
    action_type: 'push_capture_request',
    action_payload: {
      title: 'Captura tu agenda de la semana',
      body: 'Saca una foto a tu vista semanal de Outlook y Lexis extraerá los eventos.',
      url: '/?fab=calendar_image',
      type_key: 'reviews',
    },
    schedule_human: 'Lunes a las 7:30',
  },
  {
    preset_key: 'friday_review',
    name: 'Repaso de viernes',
    description:
      'Cada viernes por la tarde te paso un resumen de los deadlines pendientes para la semana siguiente y los compromisos que has cerrado en esta.',
    trigger_type: 'cron',
    trigger_config: { cron: '0 17 * * 5' },                  // viernes 17:00
    action_type: 'push_friday_review',
    action_payload: {
      type_key: 'reviews',
    },
    schedule_human: 'Viernes a las 17:00',
  },
  {
    preset_key: 'pre_meeting_context',
    name: 'Contexto antes de meeting',
    description:
      '30 minutos antes de cada reunión con asistentes externos te avisa con contexto sobre la persona o proyecto relacionado (ficha del grafo).',
    trigger_type: 'event',
    trigger_config: {
      event_kind: 'meeting_in_window',
      minutes_before: 30,
      require_external_attendees: true,
    },
    action_type: 'push_pre_meeting',
    action_payload: {
      type_key: 'meetings',
    },
    schedule_human: '30 min antes de meetings con externos',
  },
  {
    preset_key: 'commitment_followup',
    name: 'Follow-up de compromisos',
    description:
      'Cuando llega la fecha de un compromiso que has dictado ("envío X a Y antes del Z"), te pregunta si lo has hecho con un tap.',
    trigger_type: 'event',
    trigger_config: {
      event_kind: 'event_due_today',
      event_type: 'follow_up',
    },
    action_type: 'push_followup_check',
    action_payload: {
      type_key: 'follow_ups',
    },
    schedule_human: 'El día del follow-up',
  },
  {
    preset_key: 'dormant_project',
    name: 'Proyecto durmiendo',
    description:
      'Si un proyecto activo lleva más de 30 días sin captura, te avisa y pregunta si sigue activo, si lo archivas o si lo pospones.',
    trigger_type: 'cron',
    trigger_config: {
      cron: '0 9 * * 1',                                     // lunes 9:00
      check_kind: 'dormant_projects',
      threshold_days: 30,
    },
    action_type: 'push_dormant_project_check',
    action_payload: {
      type_key: 'reviews',
    },
    schedule_human: 'Lunes a las 9:00',
  },
];

export function findPreset(key: string): PresetDefinition | undefined {
  return PRESETS.find((p) => p.preset_key === key);
}
