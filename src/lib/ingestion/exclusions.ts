// =====================================================
// Temas excluidos de la memoria
//
// Hay asuntos que el usuario NO quiere que Lexis guarde nunca. Este filtro se aplica ANTES de guardar
// nada —turno del chat, captura, conector o foto— y también antes de responder,
// para que el asistente pueda decir «este asunto no lo guardo».
//
// Los términos NO están en el código (el repo es público): viven en dos
// variables de entorno de Vercel, escritas SIN tildes y en minúsculas:
//   EXCLUDED_TOPICS_STRONG  -> alternativa regex; UNA coincidencia excluye
//                              (nombres propios del asunto).
//   EXCLUDED_TOPICS_WEAK    -> alternativa regex; hacen falta DOS términos
//                              distintos para excluir (vocabulario genérico:
//                              una palabra suelta no excluye).
// Usar \b en los términos débiles para que una palabra común que los contenga
// no dispare el filtro.
// Si no hay variables configuradas, no se filtra nada y se avisa en el log.
// =====================================================

export interface ExclusionResult {
  excluded: boolean;
  /** false si no hay términos configurados en el entorno. */
  configured: boolean;
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function compilar(raw: string | undefined): RegExp | null {
  const src = (raw || '').trim();
  if (!src) return null;
  try {
    return new RegExp(src, 'gi');
  } catch {
    console.error('[exclusions] regex inválida en el entorno');
    return null;
  }
}

let avisado = false;

export function comprobarExclusion(...textos: Array<string | null | undefined>): ExclusionResult {
  const fuerte = compilar(process.env.EXCLUDED_TOPICS_STRONG);
  const debil = compilar(process.env.EXCLUDED_TOPICS_WEAK);
  if (!fuerte && !debil) {
    if (!avisado) {
      console.warn('[exclusions] sin EXCLUDED_TOPICS_* configurados: no se filtra nada');
      avisado = true;
    }
    return { excluded: false, configured: false };
  }

  const texto = normalizar(textos.filter(Boolean).join('\n'));
  if (!texto.trim()) return { excluded: false, configured: true };

  if (fuerte && fuerte.test(texto)) return { excluded: true, configured: true };

  if (debil) {
    const distintos = new Set((texto.match(debil) || []).map((m) => m.trim()));
    if (distintos.size >= 2) return { excluded: true, configured: true };
  }
  return { excluded: false, configured: true };
}
