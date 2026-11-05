// =====================================================
// Correcciones desde el chat del asistente (2026-11-05)
//
// «No, es Casa Montaña» o «eso está mal, es de Alzira» no dicen QUÉ se corrige:
// guardado suelto quedaba «realiza una corrección puntual…», nadie lo encontraba
// y la siguiente respuesta repetía el dato viejo. Una corrección se reescribe
// con la conversación como un hecho autónomo y se guarda con su rastro: qué
// constaba antes, qué dijo el usuario y sobre qué respuesta.
//
// Aquí está lo que no llama al LLM; la resolución y el guardado, en registro.ts.
// =====================================================

export interface TurnoCorreccion {
  role: string;
  content: string;
}

/** Lo que se guarda en source_metadata.correccion de la memoria. */
export interface CorreccionGuardada {
  /** El dato bueno en una frase que se entiende sin la conversación. */
  hecho: string;
  /** Lo mismo en segunda persona, para confirmárselo al usuario. */
  para_el_usuario: string;
  antes: string | null;
  ahora: string | null;
  tema: string;
  /** Es una cifra de negocio: se registra, pero el dato oficial no se pisa. */
  sobre_cifras: boolean;
  /** Las palabras exactas del usuario. */
  dijo: string;
  /** Los últimos turnos antes de la corrección. */
  conversacion: TurnoCorreccion[];
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

const RX_INICIO =
  /^(no|mal|falso|incorrecto|error|perdon|perdona|corrige|corrigelo|rectifica|en realidad|eso no|esto no|te equivocas|te has equivocado|te confundes|te has confundido|me he equivocado|me equivoque|me confundi)\b/;

const RX_DENTRO =
  /\b(no es correcto|no es cierto|no es verdad|no es asi|no es eso|esta mal|es incorrecto|es erroneo|es falso|te equivocas|te has equivocado|te confundes|me he equivocado|me equivoque|corrige|corrigelo|rectifica|lo correcto es|el dato (bueno|correcto) es|en realidad (es|son|fue|era|se llama)|no (es|son|fue|era|se llama)\b)/;

// «son cinco, no cuatro» · «es de Alzira, no de ahí»
const RX_CONTRASTE = /, *no +[^,.;]{1,40}[.!]*$/;

/**
 * Primer filtro, barato: ¿puede ser una corrección? Deja pasar de más a
 * propósito («no, gracias»): lo decide el LLM, y solo se le llama en estos casos.
 */
export function pareceCorreccion(texto: string): boolean {
  const t = normalizar(texto);
  if (!t) return false;
  // Una duda no corrige nada: «¿no era Casa Carmela?»
  if (t.startsWith('¿') || t.endsWith('?')) return false;
  return RX_INICIO.test(t) || RX_DENTRO.test(t) || RX_CONTRASTE.test(t);
}

/** Lee la corrección de los metadatos de una memoria, si la tiene. */
export function correccionDe(metadata: unknown): CorreccionGuardada | null {
  const c = (metadata as { correccion?: CorreccionGuardada } | null | undefined)?.correccion;
  return c && typeof c.hecho === 'string' ? c : null;
}

/** Empieza por la marca que la regla de síntesis trata como dato bueno. */
export function textoCorreccion(c: CorreccionGuardada): string {
  const conversacion = (c.conversacion ?? [])
    .map((t) => `${t.role === 'user' ? 'Usuario' : 'Asistente'}: ${t.content}`)
    .join('\n');
  return [
    `CORRECCIÓN DEL USUARIO: ${c.hecho}`,
    c.antes ? `Antes constaba: ${c.antes}` : '',
    `Sus palabras: «${c.dijo}»`,
    conversacion ? `Conversación en la que lo corrigió:\n${conversacion}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Las cifras oficiales no se pisan: si el usuario corrigió la que se le va a
 * dar, se le recuerda lo que dijo antes del detalle.
 */
export function conAvisoCifra(respuesta: string, c: CorreccionGuardada, fecha: string): string {
  const aviso = `Ojo: el ${fecha} me dijiste esto: «${c.dijo}». Lo tengo apuntado, pero aquí sigue la cifra oficial de los datos cargados.`;
  const marca = '---detalle---';
  const i = respuesta.indexOf(marca);
  if (i === -1) return `${respuesta.trim()}\n\n${aviso}`;
  return `${respuesta.slice(0, i).trim()}\n\n${aviso}\n\n${respuesta.slice(i)}`;
}
