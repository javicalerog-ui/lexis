// =====================================================
// POST /api/digest/send
// Genera, persiste y envía el digest al email del usuario.
// Body: { cadence?, dry_run?, to_override? }
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { generateDigest } from '@/lib/digest/generate';
import { renderDigestEmail } from '@/lib/digest/render-email';
import { sendEmail } from '@/lib/digest/email';

export const runtime = 'nodejs';
export const maxDuration = 120;

const Schema = z.object({
  cadence: z.enum(['weekly', 'biweekly', 'monthly']).default('weekly'),
  dry_run: z.boolean().default(false),
  to_override: z.string().email().optional(),
});

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await req.json().catch(() => ({})));
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', detail: String(e) },
      { status: 400 }
    );
  }

  // Resolver email destino: preferencias o auth.users
  const { data: prefs } = await supabase
    .from('digest_preferences')
    .select('email, enabled')
    .eq('user_id', user.id)
    .maybeSingle();

  const destination = body.to_override || prefs?.email || user.email;
  if (!destination) {
    return NextResponse.json(
      { error: 'no_destination', detail: 'sin email destino configurado' },
      { status: 400 }
    );
  }

  try {
    // 1. Generar
    const digest = await generateDigest(supabase, user.id, body.cadence);

    // 2. Persistir como draft primero (sin html_email todavía para no duplicar; lo añadimos tras render)
    const { data: inserted, error: insErr } = await supabase
      .from('digests')
      .insert({
        user_id: user.id,
        period_start: digest.period_start,
        period_end: digest.period_end,
        cadence: body.cadence,
        payload: digest.payload,
        metrics: digest.metrics,
        model_used: digest.model_used,
        status: 'draft',
      })
      .select('id')
      .single();

    if (insErr || !inserted) {
      return NextResponse.json(
        { error: 'persist_failed', detail: insErr?.message },
        { status: 500 }
      );
    }

    // 3. Renderizar email con el id real
    const rendered = renderDigestEmail(digest, { digestId: inserted.id });

    // 4. Guardar html_email
    await supabase
      .from('digests')
      .update({ html_email: rendered.html })
      .eq('id', inserted.id);

    // 5. Si es dry_run, no enviar
    if (body.dry_run) {
      return NextResponse.json({
        digest_id: inserted.id,
        dry_run: true,
        subject: rendered.subject,
        destination,
        payload: digest.payload,
      });
    }

    // 6. Enviar via Resend
    try {
      const sent = await sendEmail({
        to: destination,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
          { name: 'kind', value: 'digest' },
          { name: 'cadence', value: body.cadence },
        ],
      });

      // 7. Marcar como enviado
      await supabase
        .from('digests')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          sent_to: destination,
          resend_message_id: sent.id,
        })
        .eq('id', inserted.id);

      // 8. Actualizar last_sent_at en preferences
      await supabase
        .from('digest_preferences')
        .upsert(
          {
            user_id: user.id,
            last_sent_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

      return NextResponse.json({
        digest_id: inserted.id,
        sent: true,
        destination,
        message_id: sent.id,
        subject: rendered.subject,
      });
    } catch (sendErr) {
      // Marcar como failed pero no perder el digest generado
      await supabase
        .from('digests')
        .update({
          status: 'failed',
          send_error: String(sendErr).slice(0, 500),
        })
        .eq('id', inserted.id);

      return NextResponse.json(
        {
          digest_id: inserted.id,
          sent: false,
          error: 'send_failed',
          detail: String(sendErr),
        },
        { status: 502 }
      );
    }
  } catch (e) {
    return NextResponse.json(
      { error: 'generation_failed', detail: String(e) },
      { status: 500 }
    );
  }
}
