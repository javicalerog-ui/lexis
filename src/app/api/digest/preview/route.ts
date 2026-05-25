// =====================================================
// POST /api/digest/preview
// Genera un digest y devuelve payload + html para preview,
// sin persistir ni enviar.
// Body: { cadence?: 'weekly'|'biweekly'|'monthly' }
// =====================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { generateDigest } from '@/lib/digest/generate';
import { renderDigestEmail } from '@/lib/digest/render-email';

export const runtime = 'nodejs';
export const maxDuration = 120;

const Schema = z.object({
  cadence: z.enum(['weekly', 'biweekly', 'monthly']).default('weekly'),
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

  try {
    const digest = await generateDigest(supabase, user.id, body.cadence);
    const rendered = renderDigestEmail(digest, {
      digestId: 'preview',
    });
    return NextResponse.json({
      digest,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'generation_failed', detail: String(e) },
      { status: 500 }
    );
  }
}
