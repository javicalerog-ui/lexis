// =====================================================
// /asistente — la pantalla única del "modo Silvestre".
// El middleware manda aquí a los usuarios con app_metadata.ui_mode='simple'.
// Javi (modo completo) puede visitarla también, pero su home sigue en '/'.
// =====================================================

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AssistantChat } from '@/components/assistant/AssistantChat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AsistentePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');
  return <AssistantChat />;
}
