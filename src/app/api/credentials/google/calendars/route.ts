// =====================================================
// GET /api/credentials/google/calendars
//
// Lista los calendarios disponibles del user en su cuenta Google
// (usa la credential con scope calendar). Útil para la UI del
// connector Calendar para que sepa qué IDs poner.
//
// Sprint 14.
// =====================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listCalendars } from '@/lib/google-calendar/write';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const items = await listCalendars(supabase, user.id);
    return NextResponse.json({ calendars: items });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes('no_google_credentials') || msg.includes('no_calendar_scope')) {
      return NextResponse.json(
        { error: 'no_calendar_credential' },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: 'calendar_list_failed', detail: msg.slice(0, 220) },
      { status: 500 }
    );
  }
}
