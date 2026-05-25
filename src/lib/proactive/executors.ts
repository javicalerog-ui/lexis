// =====================================================
// lib/proactive/executors.ts
//
// Ejecuta la acción de una regla proactiva: compone el payload
// (consultando el grafo si hace falta), crea una fila en agent_actions
// (Sprint 18 — bandeja) y manda un push (Sprint 16).
//
// Cada action_type tiene su propio executor.
//
// Sprint 17.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendPush } from '@/lib/push/send';
import { formatInZone } from '@/lib/time/userTime';

interface ExecuteContext {
  supabase: SupabaseClient;
  userId: string;
  rule: any;                                 // proactive_rules row
  timezone: string;
}

export interface ExecutionResult {
  fired: boolean;
  reason?: string;
  agent_action_id?: string;
  push_result?: any;
}

// ---------- Helper para crear agent_action ----------

async function createAgentAction(
  supabase: SupabaseClient,
  userId: string,
  ruleId: string,
  fields: {
    type: string;
    title: string;
    prompt: string;
    context?: Record<string, unknown>;
    quick_replies?: Array<{ label: string; action: string; payload?: Record<string, unknown> }>;
    open_route?: string;
    expires_at?: string;
  }
): Promise<string | null> {
  const { data, error } = await supabase
    .from('agent_actions')
    .insert({
      user_id: userId,
      rule_id: ruleId,
      type: fields.type,
      title: fields.title,
      prompt: fields.prompt,
      context: fields.context ?? {},
      quick_replies: fields.quick_replies ?? [],
      open_route: fields.open_route ?? null,
      status: 'pending',
      expires_at: fields.expires_at ?? null,
    })
    .select('id')
    .single();
  if (error) {
    console.error('createAgentAction error', error);
    return null;
  }
  return data.id;
}

// =====================================================
// Executor: push_capture_request (preset outlook_capture_weekly)
// =====================================================

async function executePushCaptureRequest(ctx: ExecuteContext): Promise<ExecutionResult> {
  const payload = ctx.rule.action_payload || {};
  const title = payload.title || 'Captura tu agenda';
  const body = payload.body || 'Saca una foto a tu vista semanal y la incorporo a Lexis.';
  const url = payload.url || '/?fab=calendar_image';

  const aaId = await createAgentAction(ctx.supabase, ctx.userId, ctx.rule.id, {
    type: 'capture_request',
    title,
    prompt: body,
    open_route: url,
    quick_replies: [
      { label: 'Captura ahora', action: 'open_route' },
      { label: 'Mañana', action: 'snooze_1d' },
      { label: 'Ya lo tengo', action: 'dismiss' },
    ],
  });

  const push = await sendPush(
    ctx.supabase,
    ctx.userId,
    {
      title,
      body,
      url: aaId ? `/inbox?action=${aaId}` : url,
      tag: 'capture_request',
      data: { agent_action_id: aaId },
    },
    { type_key: payload.type_key as string }
  );

  return { fired: true, agent_action_id: aaId ?? undefined, push_result: push };
}

// =====================================================
// Executor: push_friday_review (preset friday_review)
// =====================================================

async function executePushFridayReview(ctx: ExecuteContext): Promise<ExecutionResult> {
  // Eventos pendientes próximos 7 días + follow-ups no respondidos
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 86400_000).toISOString();

  const { data: upcoming } = await ctx.supabase
    .from('events')
    .select('id, title, due_at, type')
    .eq('user_id', ctx.userId)
    .eq('status', 'pending')
    .gte('due_at', now.toISOString())
    .lte('due_at', in7d)
    .order('due_at', { ascending: true })
    .limit(8);

  const count = upcoming?.length || 0;
  const headline =
    count === 0
      ? 'Semana ligera, sin compromisos abiertos.'
      : `Tienes ${count} compromiso${count > 1 ? 's' : ''} la semana que viene.`;

  const lines: string[] = [];
  for (const ev of upcoming ?? []) {
    lines.push(`· ${formatInZone(new Date(ev.due_at), ctx.timezone, 'es-ES')} — ${ev.title}`);
  }

  const aaId = await createAgentAction(ctx.supabase, ctx.userId, ctx.rule.id, {
    type: 'review_prompt',
    title: 'Repaso del viernes',
    prompt: headline + (lines.length > 0 ? '\n\n' + lines.join('\n') : ''),
    context: { events: upcoming ?? [] },
    open_route: '/feed',
    quick_replies: [
      { label: 'Ver feed', action: 'open_route' },
      { label: 'Cerrar', action: 'dismiss' },
    ],
  });

  const push = await sendPush(
    ctx.supabase,
    ctx.userId,
    {
      title: 'Repaso del viernes',
      body: headline,
      url: aaId ? `/inbox?action=${aaId}` : '/feed',
      tag: 'friday_review',
      data: { agent_action_id: aaId },
    },
    { type_key: 'reviews' }
  );

  return { fired: true, agent_action_id: aaId ?? undefined, push_result: push };
}

// =====================================================
// Executor: push_pre_meeting (preset pre_meeting_context)
// =====================================================

async function executePushPreMeeting(ctx: ExecuteContext): Promise<ExecutionResult> {
  // Buscar eventos meeting con due_at entre +25 y +35 min con attendees externos
  const cfg = ctx.rule.trigger_config || {};
  const minutesBefore = (cfg.minutes_before as number) ?? 30;
  const requireExt = (cfg.require_external_attendees as boolean) ?? true;

  const windowStart = new Date(Date.now() + (minutesBefore - 5) * 60_000).toISOString();
  const windowEnd = new Date(Date.now() + (minutesBefore + 5) * 60_000).toISOString();

  const { data: candidates } = await ctx.supabase
    .from('events')
    .select('id, title, due_at, type, linked_entity_id, linked_project_id, metadata, external_event_id')
    .eq('user_id', ctx.userId)
    .eq('status', 'pending')
    .in('type', ['meeting'])
    .gte('due_at', windowStart)
    .lte('due_at', windowEnd);

  if (!candidates || candidates.length === 0) {
    return { fired: false, reason: 'no_meetings_in_window' };
  }

  const results: any[] = [];
  for (const ev of candidates) {
    const attendees = ((ev.metadata as any)?.attendees as string[]) || [];
    if (requireExt) {
      const onlySelfDomain = attendees.length === 0;
      if (onlySelfDomain) continue;
    }

    // Buscar contexto de entidad asociada (si la hay)
    let entityContext = '';
    if (ev.linked_entity_id) {
      const { data: entity } = await ctx.supabase
        .from('entities')
        .select('name, summary_md')
        .eq('id', ev.linked_entity_id)
        .single();
      if (entity) {
        entityContext = `\n\nContexto de ${entity.name}:\n${(entity.summary_md ?? '').slice(0, 400)}`;
      }
    }
    if (!entityContext && ev.linked_project_id) {
      const { data: project } = await ctx.supabase
        .from('projects')
        .select('name')
        .eq('id', ev.linked_project_id)
        .single();
      if (project) entityContext = `\n\nProyecto vinculado: ${project.name}`;
    }

    const body = `En ${minutesBefore} min: ${ev.title}${
      attendees.length > 0 ? ` · con ${attendees.slice(0, 3).join(', ')}` : ''
    }`;

    const aaId = await createAgentAction(ctx.supabase, ctx.userId, ctx.rule.id, {
      type: 'pre_meeting_context',
      title: ev.title,
      prompt: body + entityContext,
      context: {
        event_id: ev.id,
        attendees,
        linked_entity_id: ev.linked_entity_id,
        linked_project_id: ev.linked_project_id,
      },
      open_route: ev.linked_entity_id
        ? `/entities/${ev.linked_entity_id}`
        : ev.linked_project_id
          ? `/projects/${ev.linked_project_id}`
          : '/feed',
      quick_replies: [
        { label: 'Ver contexto', action: 'open_route' },
        { label: 'Cerrar', action: 'dismiss' },
      ],
      expires_at: ev.due_at,
    });

    const push = await sendPush(
      ctx.supabase,
      ctx.userId,
      {
        title: `En ${minutesBefore} min · ${ev.title}`,
        body: entityContext.trim().slice(0, 200) || body,
        url: aaId ? `/inbox?action=${aaId}` : '/feed',
        tag: `pre_meeting_${ev.id}`,
        data: { agent_action_id: aaId, event_id: ev.id },
      },
      { type_key: 'meetings' }
    );

    results.push({ event_id: ev.id, aa_id: aaId, push });
  }

  if (results.length === 0) {
    return { fired: false, reason: 'all_meetings_internal' };
  }
  return { fired: true, push_result: results };
}

// =====================================================
// Executor: push_followup_check (preset commitment_followup)
// =====================================================

async function executePushFollowupCheck(ctx: ExecuteContext): Promise<ExecutionResult> {
  const now = new Date();
  const inDayStart = new Date(now);
  inDayStart.setUTCHours(0, 0, 0, 0);
  const inDayEnd = new Date(now);
  inDayEnd.setUTCHours(23, 59, 59, 999);

  const { data: followups } = await ctx.supabase
    .from('events')
    .select('id, title, due_at, description')
    .eq('user_id', ctx.userId)
    .eq('status', 'pending')
    .eq('type', 'follow_up')
    .gte('due_at', inDayStart.toISOString())
    .lte('due_at', inDayEnd.toISOString());

  if (!followups || followups.length === 0) {
    return { fired: false, reason: 'no_followups_today' };
  }

  const results: any[] = [];
  for (const ev of followups) {
    const aaId = await createAgentAction(ctx.supabase, ctx.userId, ctx.rule.id, {
      type: 'followup_check',
      title: ev.title,
      prompt: `Hoy era el día. ¿${ev.title.toLowerCase()}?`,
      context: { event_id: ev.id },
      quick_replies: [
        { label: 'Hecho', action: 'mark_event_done', payload: { event_id: ev.id } },
        { label: 'Posponer 2 días', action: 'snooze_event_2d', payload: { event_id: ev.id } },
        { label: 'Ya no aplica', action: 'cancel_event', payload: { event_id: ev.id } },
      ],
      expires_at: new Date(now.getTime() + 7 * 86400_000).toISOString(),
    });

    const push = await sendPush(
      ctx.supabase,
      ctx.userId,
      {
        title: ev.title,
        body: '¿Lo has hecho? Responde con un tap.',
        url: aaId ? `/inbox?action=${aaId}` : '/feed',
        tag: `followup_${ev.id}`,
        actions: [
          { action: 'mark_event_done', title: 'Hecho' },
          { action: 'snooze_event_2d', title: 'Posponer' },
        ],
        data: { agent_action_id: aaId, event_id: ev.id },
      },
      { type_key: 'follow_ups' }
    );

    results.push({ event_id: ev.id, aa_id: aaId, push });
  }

  return { fired: true, push_result: results };
}

// =====================================================
// Executor: push_dormant_project_check (preset dormant_project)
// =====================================================

async function executePushDormantProject(ctx: ExecuteContext): Promise<ExecutionResult> {
  const cfg = ctx.rule.trigger_config || {};
  const thresholdDays = (cfg.threshold_days as number) ?? 30;
  const thresholdIso = new Date(Date.now() - thresholdDays * 86400_000).toISOString();

  // Proyectos activos con su última captura
  const { data: projects } = await ctx.supabase.rpc('dormant_projects_summary', {
    p_user_id: ctx.userId,
    p_threshold_iso: thresholdIso,
  });

  // Si la RPC no existe (no la hemos creado), fallback inline
  let dormant: any[] = projects ?? [];
  if (!projects) {
    const { data: projs } = await ctx.supabase
      .from('projects')
      .select('id, name, status, updated_at')
      .eq('user_id', ctx.userId)
      .eq('status', 'active');
    dormant = [];
    for (const p of projs ?? []) {
      const { data: lastMem } = await ctx.supabase
        .from('memory_projects')
        .select('memories(captured_at)')
        .eq('project_id', p.id)
        .order('captured_at', { referencedTable: 'memories', ascending: false })
        .limit(1)
        .maybeSingle();
      const lastCapture = (lastMem as any)?.memories?.captured_at as string | undefined;
      if (!lastCapture || new Date(lastCapture).toISOString() < thresholdIso) {
        const daysSince = lastCapture
          ? Math.floor((Date.now() - new Date(lastCapture).getTime()) / 86400_000)
          : 9999;
        dormant.push({ id: p.id, name: p.name, days_since: daysSince, last_capture: lastCapture });
      }
    }
  }

  if (dormant.length === 0) {
    return { fired: false, reason: 'no_dormant_projects' };
  }

  const results: any[] = [];
  for (const proj of dormant.slice(0, 5)) {
    const aaId = await createAgentAction(ctx.supabase, ctx.userId, ctx.rule.id, {
      type: 'dormant_project_check',
      title: `${proj.name} lleva ${proj.days_since} días sin captura`,
      prompt: `El proyecto "${proj.name}" lleva ${proj.days_since} días sin ninguna captura nueva. ¿Sigue activo?`,
      context: { project_id: proj.id, days_since: proj.days_since, last_capture: proj.last_capture },
      quick_replies: [
        { label: 'Sigue activo', action: 'project_keep_active', payload: { project_id: proj.id } },
        { label: 'Archivar', action: 'project_archive', payload: { project_id: proj.id } },
        { label: 'Posponer revisión 14 días', action: 'project_snooze_14d', payload: { project_id: proj.id } },
      ],
      open_route: `/projects/${proj.id}`,
      expires_at: new Date(Date.now() + 14 * 86400_000).toISOString(),
    });

    const push = await sendPush(
      ctx.supabase,
      ctx.userId,
      {
        title: `${proj.name} durmiendo`,
        body: `Sin captura desde hace ${proj.days_since} días. ¿Sigue activo?`,
        url: aaId ? `/inbox?action=${aaId}` : `/projects/${proj.id}`,
        tag: `dormant_${proj.id}`,
        actions: [
          { action: 'project_keep_active', title: 'Sigue activo' },
          { action: 'project_archive', title: 'Archivar' },
        ],
        data: { agent_action_id: aaId, project_id: proj.id },
      },
      { type_key: 'reviews' }
    );

    results.push({ project_id: proj.id, aa_id: aaId, push });
  }

  return { fired: true, push_result: results };
}

// =====================================================
// Executor: push_simple (genérico para reglas custom)
// =====================================================

async function executePushSimple(ctx: ExecuteContext): Promise<ExecutionResult> {
  const payload = ctx.rule.action_payload || {};
  const title = payload.title || ctx.rule.name;
  const body = payload.body || ctx.rule.description || 'Aviso';
  const url = payload.url || '/inbox';
  const quickReplies = payload.quick_replies || [
    { label: 'Visto', action: 'dismiss' },
  ];

  const aaId = await createAgentAction(ctx.supabase, ctx.userId, ctx.rule.id, {
    type: 'custom_alert',
    title,
    prompt: body,
    open_route: url,
    quick_replies: quickReplies as any,
  });

  const push = await sendPush(
    ctx.supabase,
    ctx.userId,
    {
      title,
      body,
      url: aaId ? `/inbox?action=${aaId}` : url,
      tag: `rule_${ctx.rule.id}`,
      data: { agent_action_id: aaId },
    },
    { type_key: payload.type_key as string }
  );

  return { fired: true, agent_action_id: aaId ?? undefined, push_result: push };
}

// ---------- Dispatcher ----------

const EXECUTORS: Record<string, (ctx: ExecuteContext) => Promise<ExecutionResult>> = {
  push_capture_request: executePushCaptureRequest,
  push_friday_review: executePushFridayReview,
  push_pre_meeting: executePushPreMeeting,
  push_followup_check: executePushFollowupCheck,
  push_dormant_project_check: executePushDormantProject,
  push_simple: executePushSimple,
};

export async function executeAction(ctx: ExecuteContext): Promise<ExecutionResult> {
  const exec = EXECUTORS[ctx.rule.action_type];
  if (!exec) {
    return { fired: false, reason: `unknown_action_type:${ctx.rule.action_type}` };
  }
  return exec(ctx);
}
