// =====================================================
// /asistente — la pantalla única del "modo Silvestre".
// El middleware manda aquí a los usuarios con app_metadata.ui_mode='simple'.
// Javi (modo completo) puede visitarla también, pero su home sigue en '/'.
//
// ?aviso=<event_id>: viene de tocar una notificación de recordatorio; el chat
// enseña ese aviso arriba.
// =====================================================

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/auth/admin';
import { cuandoLlano } from '@/lib/assistant/registro';
import { AssistantChat, type Ejemplo } from '@/components/assistant/AssistantChat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Preguntas de ejemplo de la bienvenida. Overridable sin desplegar código:
// ASSISTANT_EJEMPLOS="¿Pregunta 1?|¿Pregunta 2?|Recuérdame mañana a las 9…"
// (las que acaban en «…» se escriben en la caja para completarlas, no se envían).
function ejemplos(conDatos: boolean): Ejemplo[] {
  const env = (process.env.ASSISTANT_EJEMPLOS || '').split('|').map((s) => s.trim()).filter(Boolean);
  const lista = env.length
    ? env
    : [
        conDatos ? '¿Cómo van este año las ventas en Francia?' : '¿Qué tengo apuntado de esta semana?',
        '¿Qué sabes de mí?',
        'Recuérdame mañana a las 9…',
      ];
  return lista.slice(0, 3).map((texto) =>
    texto.endsWith('…') ? { texto, completar: texto.slice(0, -1) + ' ' } : { texto }
  );
}

export default async function AsistentePage({
  searchParams,
}: {
  searchParams: { aviso?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login?next=/asistente');

  const nombreCompleto = String(user.user_metadata?.full_name || user.user_metadata?.nombre || '').trim();
  const nombre = nombreCompleto.split(/\s+/)[0] || null;
  const conDatos = isAdmin(user) || user.app_metadata?.datos_access === true;

  let aviso: { id: string; titulo: string; cuando: string } | null = null;
  const avisoId = searchParams.aviso;
  if (avisoId && /^[0-9a-f-]{36}$/i.test(avisoId)) {
    const { data } = await supabase
      .from('events')
      .select('id, title, due_at, all_day')
      .eq('id', avisoId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (data) {
      const { data: ajustes } = await supabase
        .from('user_settings')
        .select('timezone')
        .eq('user_id', user.id)
        .maybeSingle();
      aviso = {
        id: data.id,
        titulo: data.title,
        cuando: cuandoLlano({ due_at: data.due_at, all_day: data.all_day, timezone: ajustes?.timezone }),
      };
    }
  }

  return (
    <AssistantChat
      userId={user.id}
      nombre={nombre}
      ejemplos={ejemplos(conDatos)}
      aviso={aviso}
    />
  );
}
