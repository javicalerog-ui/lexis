// =====================================================
// /settings no tenía página propia -> 404 (visto en vivo: el botón "atrás"
// del navegador puede aterrizar aquí). Redirige al destino más útil.
// =====================================================
import { redirect } from 'next/navigation';

export default function SettingsIndex() {
  redirect('/settings/notifications');
}
