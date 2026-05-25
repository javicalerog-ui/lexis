// =====================================================
// lib/proactive/manage.ts
//
// Gestión de reglas proactivas server-side:
//   - ensurePresetsForUser: crea las 5 presets si no existen.
//   - detectConflicts: pregunta al LLM si una regla nueva entra
//     en conflicto con alguna existente.
//
// Sprint 17.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { chatWithEscalation } from '@/lib/llm/escalation';
import { loadUserSettings, nextCronFireUtc } from '@/lib/time/userTime';
import { PRESETS } from './presets';

// ---------- Presets ----------

export async function ensurePresetsForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<{ created: number; existing: number }> {
  const settings = await loadUserSettings(supabase, userId, { createIfMissing: true });
  const tz = settings.timezone;

  const { data: existing } = await supabase
    .from('proactive_rules')
    .select('preset_key')
    .eq('user_id', userId)
    .eq('kind', 'preset');

  const existingKeys = new Set((existing ?? []).map((r) => r.preset_key as string));
  const toCreate = PRESETS.filter((p) => !existingKeys.has(p.preset_key));

  if (toCreate.length === 0) {
    return { created: 0, existing: existingKeys.size };
  }

  const rows = toCreate.map((p) => {
    let nextDue: string | null = null;
    if (p.trigger_type === 'cron') {
      const cron = (p.trigger_config as any).cron as string;
      const nxt = nextCronFireUtc(cron, tz);
      nextDue = nxt ? nxt.toISOString() : null;
    }
    return {
      user_id: userId,
      kind: 'preset' as const,
      preset_key: p.preset_key,
      name: p.name,
      description: p.description,
      trigger_type: p.trigger_type,
      trigger_config: p.trigger_config,
      action_type: p.action_type,
      action_payload: p.action_payload,
      enabled: true,
      timezone: tz,
      next_due_at: nextDue,
    };
  });

  const { error } = await supabase.from('proactive_rules').insert(rows);
  if (error) {
    console.error('ensurePresetsForUser insert error', error);
  }
  return { created: toCreate.length, existing: existingKeys.size };
}

// ---------- Detector de conflictos LLM ----------

interface ConflictDetectionInput {
  new_rule: {
    name: string;
    description: string;
    trigger_type: 'cron' | 'event';
    trigger_config: Record<string, unknown>;
    action_type: string;
  };
  existing_rules: Array<{
    id: string;
    name: string;
    description: string;
    trigger_type: string;
    trigger_config: Record<string, unknown>;
    action_type: string;
    enabled: boolean;
    kind: 'preset' | 'custom';
  }>;
}

export interface ConflictResult {
  has_conflict: boolean;
  conflicting_rule_id: string | null;
  conflict_kind: 'duplicate' | 'overlap' | 'shadowing' | 'none';
  explanation: string;                       // texto en español que se le mostrará al user
  confidence: number;
}

const CONFLICT_SYSTEM_PROMPT = `Eres un analista de reglas de notificación. Tu tarea: detectar si una NUEVA regla entra en conflicto con alguna de las existentes del usuario.

Conflicto = al menos uno de:
  - "duplicate": la nueva hace exactamente lo mismo en el mismo momento.
  - "overlap": las dos disparan en momentos solapados con acción parecida, generando avisos redundantes.
  - "shadowing": una de las dos hace todo lo que hace la otra Y MÁS (la otra queda inútil).

No es conflicto:
  - Mismo trigger pero acción muy distinta (un cron lunes 9am puede tener dos reglas: una repasa proyectos, otra revisa salud).
  - Triggers diferentes que solo coinciden ocasionalmente.

Devuelve JSON estricto:
{
  "has_conflict": true|false,
  "conflicting_rule_id": "uuid o null",
  "conflict_kind": "duplicate" | "overlap" | "shadowing" | "none",
  "explanation": "En español, máximo 3 frases. Explica exactamente qué solapan o por qué la nueva regla puede ser redundante con la existente. Si no hay conflicto, devuelve string vacío.",
  "confidence": 0.0-1.0
}

Si has_conflict=true, conflicting_rule_id DEBE ser un ID de la lista de existing_rules.
Si no hay conflicto, has_conflict=false y conflicting_rule_id=null.

Sé estricto: prefiere has_conflict=false con confidence alta a falsos positivos. El user prefiere ver demasiadas reglas válidas que recibir falsas alertas.`;

export async function detectConflicts(
  input: ConflictDetectionInput
): Promise<ConflictResult> {
  // Si no hay reglas existentes habilitadas, no puede haber conflicto
  const activeExisting = input.existing_rules.filter((r) => r.enabled);
  if (activeExisting.length === 0) {
    return {
      has_conflict: false,
      conflicting_rule_id: null,
      conflict_kind: 'none',
      explanation: '',
      confidence: 1.0,
    };
  }

  const userPrompt = `Regla NUEVA propuesta:
${JSON.stringify(input.new_rule, null, 2)}

Reglas EXISTENTES del usuario (todas activas):
${JSON.stringify(activeExisting, null, 2)}

Analiza y devuelve JSON estricto.`;

  try {
    const { parsed } = await chatWithEscalation<ConflictResult>(userPrompt, {
      system: CONFLICT_SYSTEM_PROMPT,
      temperature: 0.1,
      max_tokens: 600,
      confidence_field: 'confidence' as keyof ConflictResult,
    });

    // Validación defensiva
    if (parsed.has_conflict && !parsed.conflicting_rule_id) {
      return {
        has_conflict: false,
        conflicting_rule_id: null,
        conflict_kind: 'none',
        explanation: '',
        confidence: parsed.confidence ?? 0.5,
      };
    }
    if (
      parsed.has_conflict &&
      !activeExisting.find((r) => r.id === parsed.conflicting_rule_id)
    ) {
      // El LLM inventó un ID; descartar
      return {
        has_conflict: false,
        conflicting_rule_id: null,
        conflict_kind: 'none',
        explanation: '',
        confidence: 0.5,
      };
    }
    return parsed;
  } catch (e) {
    console.error('detectConflicts error', e);
    // Si el detector falla, mejor permitir la creación (no bloquear al user por un fallo de infra)
    return {
      has_conflict: false,
      conflicting_rule_id: null,
      conflict_kind: 'none',
      explanation: '',
      confidence: 0.0,
    };
  }
}
