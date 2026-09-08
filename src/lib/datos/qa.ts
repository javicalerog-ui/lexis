// =====================================================
// Pregunta de negocio -> SQL -> resultado agregado -> respuesta redactada.
// Port de datos_qa.py (Clavis) a Lexis. El LLM solo ve el esquema y escribe el
// SELECT; los datos no salen del servidor salvo el resultado ya agregado.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { chat } from '@/lib/llm/escalation';
import { ESQUEMA_DATOS } from './schema-prompt';
import { ejecutarSqlDatos, formatearResultado } from './run';

export interface TurnoChat {
  role: 'user' | 'assistant' | string;
  content: string;
}

const SQL_PROMPT = (esquema: string, hoy: string, anioActual: number) =>
  `Eres un traductor de preguntas de negocio a SQL de PostgreSQL. Devuelves EXCLUSIVAMENTE una consulta SQL, sin explicaciones, sin markdown, sin \`\`\`.

HOY ES ${hoy} (año en curso: ${anioActual}). Interpreta con esta fecha "este año", "el año pasado", "el mes pasado", "los últimos meses", etc.

ESQUEMA DISPONIBLE:
${esquema}

REGLAS OBLIGATORIAS:
- Solo SELECT. Nunca modifiques datos. Una sola sentencia, sin punto y coma final.
- Agrega SIEMPRE (SUM, AVG, COUNT...). Nunca devuelvas filas en crudo.
- Limita a 20 filas como mucho, salvo que pidan más.
- Redondea importes: round(sum(eur), 2). Divide entre 1e6 si hablas de millones.

CÁLCULOS (reglas heredadas de los GPT de análisis, no negociables):
- PRECIO MEDIO = sum(eur)/sum(mt2). NUNCA avg(eur/mt2): el promedio simple de filas da un número distinto y falso.
- YTD = suma desde enero hasta el mes pedido (mes_num <= N). Derívalo de los meses; nunca supongas acumulados precalculados.
- ANUAL de un año en curso = suma de los meses disponibles. No anualices ni proyectes salvo que lo pidan.
- COMPARAR AÑOS INCOMPLETOS: por defecto compara los MISMOS MESES del año anterior (si 2026 llega a julio, compara ene-jul de ambos).
- CUOTA o PESO = ratio de sumas, con los mismos filtros de periodo y país en numerador y denominador.
- Los valores negativos (abonos, devoluciones) y los ceros son datos válidos: no los filtres salvo que lo pidan.

VOCABULARIO DEL DIRECTIVO:
  ventas / facturación / importe / ingresos / cifra de negocio -> eur
  volumen / metros / m2 / superficie                           -> mt2
  precio medio / €/m2 / rentabilidad media                     -> sum(eur)/sum(mt2)
  cuota / peso / participación / penetración                   -> ratio
  compras / gasto / coste                                      -> proveedores.valor_eur
  mercado / destino                                            -> pais
  Italia / italianos / competencia italiana                    -> fuente='Confindustria'
  el sector / la industria española                            -> fuente='Ascer'
- FILTRAR por país o provincia: usa la columna normal (pais, provincia, pais_filial) con el nombre tal cual: WHERE pais = 'Francia'.
- ⚠️ Las columnas *_norm (pais_norm, provincia_norm, pais_filial_norm) están en MINÚSCULAS y SIN ACENTOS ('francia', 'mexico', 'reino unido'). Son SOLO para JOIN. Si filtras por ellas, el literal debe ir en minúsculas y sin tildes: pais_norm = 'francia' ✅ · pais_norm = 'Francia' ❌ (no encontraría nada).
- Si dudas de cómo se escribe un país, filtra con ILIKE sobre la columna normal: WHERE pais ILIKE '%franc%'.
- 'periodo' es AAAAMM (entero). Para comparar acumulados de fuentes distintas ALINEA el mes de corte con mes_num <= N, mirando COBERTURA TEMPORAL.
- proveedores son COMPRAS: nunca las sumes con las tablas de venta.
- venta_sociedad.pais_filial es el domicilio de la filial, NO el destino de la venta. Si preguntan por destino de exportación, usa venta_terceros o mercado_intl.
- mercado_intl.fuente: 'Ascer' = exportación TOTAL del sector español (Porcelanosa incluida), 'Confindustria' = sector italiano, 'Porcelanosa' = exportación DIRECTA del grupo a terceros.
- ⭐ «¿CUÁNTO VENDIMOS EN <PAÍS>?» → usa SIEMPRE la vista ventas_pais, que une los dos canales, y devuelve el TOTAL más el desglose por canal:
  SELECT canal, round(sum(eur),2) AS eur FROM ventas_pais WHERE pais='Francia' AND anio=2025 GROUP BY ROLLUP(canal)
  (el ROLLUP añade la fila del total). Nunca respondas con un solo canal como si fuera la venta del país.
- CUOTA: Porcelanosa/Ascer del mismo país y periodo. Pero la serie 'Porcelanosa' NO incluye la venta de las filiales propias (venta_sociedad), que suma un importe parecido. Si preguntan cuota o "cómo vamos frente al sector", calcula AMBAS (solo exportación directa y sumando venta_sociedad) para advertir el rango.
- COMPARATIVA de precio medio: eur/mt2 por fuente es válido (Porcelanosa ~23 €/m² vs sector español ~10 e italiano ~16). Usa el mismo periodo para las tres.
- SI PREGUNTA QUÉ DATOS O FUENTES TIENES (no una cifra, sino el inventario): responde con la cobertura, p. ej. SELECT tabla, fuente, periodo_min, periodo_max, filas FROM dim_cobertura ORDER BY tabla.
- COHERENCIA EN EL SEGUIMIENTO: si la respuesta anterior salió de ventas_pais y ahora preguntan un detalle de esa misma cifra, SIGUE en ventas_pais. No te cambies a mercado_intl ni venta_terceros a media conversación: sus totales son parecidos pero NO iguales.

Si la pregunta NO se puede responder con este esquema, devuelve exactamente: IMPOSIBLE`;

const RESPUESTA_PROMPT = `Eres el asistente ejecutivo. Responde a la pregunta del directivo usando ÚNICAMENTE los datos de la tabla de resultados que te doy.

Formato:
1. **Conclusión** — la respuesta directa, en una o dos frases.
2. **Datos clave** — las cifras que la sustentan (puedes reproducir la tabla si aporta).
3. **Interpretación** — qué significa para el negocio.
4. **Siguiente paso** — solo si aporta algo real.

Reglas:
- CERO invención: si un dato no está en la tabla, no lo menciones.
- No cites la consulta SQL ni hables de tablas o columnas: habla de negocio.
- NUNCA hables de la herramienta como un informe con fallos ("el sistema no consolida bien", "hay una discrepancia en la tabla"): el directivo quiere el dato. Si dos cifras no cuadran, casi siempre es porque miden PERÍMETROS distintos (exportación directa vs venta de filiales): explícalo en términos de negocio.
- Si das ventas de un país, di SIEMPRE de qué perímetro hablas (exportación directa, venta de filial, o la suma): confundirlos cambia la cifra al doble.
- ⚠️ SI EL RESULTADO VIENE VACÍO: di simplemente que no has podido obtener ese dato y ofrece reformular. PROHIBIDO especular sobre POR QUÉ no hay datos ("no se han procesado operaciones", "no hay ventas en ese mercado"): un resultado vacío casi siempre significa que la consulta no encontró las filas, NO que el negocio no exista.
- Si te aviso de un desajuste de cobertura temporal, adviértelo.

FORMATO NUMÉRICO (español):
- Euros: 1.234.567,89 € — o en millones si es grande (231,4 M€).
- Metros: 5.410 m² sin decimales. Precio medio: 23,46 €/m².
- Variaciones: +13,0 % o −8,5 % (siempre con signo). Nunca notación científica.

DECIR SIEMPRE LA MODALIDAD del periodo: «en el mes», «acumulado enero-julio», «año completo» o «año en curso, con los meses disponibles». Si el año está incompleto, dilo; nunca lo presentes como cerrado.

- Un hueco de datos NO es un cero: si algo no está, di «sin dato», no «0».
- Si un denominador es cero o falta, di «no calculable», no inventes el ratio.
- Si la tabla trae más de 15 filas, resume las relevantes y ofrece el detalle.`;

function limpiarSql(bruto: string): string {
  let t = bruto.trim();
  t = t.replace(/^```(?:sql)?\s*/i, '');
  t = t.replace(/\s*```$/i, '');
  return t.trim();
}

function conContexto(pregunta: string, historial?: TurnoChat[]): string {
  if (!historial || !historial.length) return pregunta;
  const lineas = historial.slice(-4).map((m) => {
    const quien = m.role === 'user' ? 'Directivo' : 'Asistente';
    return `${quien}: ${String(m.content ?? '').slice(0, 400)}`;
  });
  return (
    'CONVERSACIÓN PREVIA (para resolver referencias como «y el año pasado», ' +
    '«por marcas», «¿y en volumen?»; si la pregunta nueva no menciona país, ' +
    'periodo o filtro, ARRASTRA los de la pregunta anterior):\n' +
    lineas.join('\n') +
    `\n\nPREGUNTA ACTUAL: ${pregunta}`
  );
}

function hoyMadrid(): { fecha: string; anio: number } {
  const fmt = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const anio = Number(get('year'));
  return { fecha: `${get('day')}/${get('month')}/${get('year')}`, anio };
}

async function coberturaTexto(supabase: SupabaseClient): Promise<string> {
  const r = await ejecutarSqlDatos(
    supabase,
    'select tabla, fuente, periodo_min, periodo_max from dim_cobertura order by tabla, fuente'
  );
  if (!r.ok || !r.rows.length) return '';
  const lineas = r.rows.map((row) => {
    const etq = row.fuente && row.fuente !== '-' ? `${row.tabla} (${row.fuente})` : String(row.tabla);
    return `  ${etq}: ${row.periodo_min} .. ${row.periodo_max}`;
  });
  return '\n\nCOBERTURA TEMPORAL (periodo = AAAAMM):\n' + lineas.join('\n');
}

/**
 * Devuelve la respuesta redactada, o null si no aplica (para que el chat siga
 * su curso normal). Nunca lanza.
 */
export async function responderPreguntaDatos(
  supabase: SupabaseClient,
  pregunta: string,
  historial?: TurnoChat[]
): Promise<string | null> {
  let esquema = ESQUEMA_DATOS;
  try {
    esquema += await coberturaTexto(supabase);
  } catch {
    // sin cobertura live, seguimos con el esquema estático
  }

  const { fecha, anio } = hoyMadrid();

  let bruto: string;
  try {
    const resp = await chat(conContexto(pregunta, historial), {
      system: SQL_PROMPT(esquema, fecha, anio),
      tier: 'fast',
      temperature: 0,
      max_tokens: 500,
    });
    bruto = resp.text;
  } catch {
    return null;
  }

  const sql = limpiarSql(bruto);
  if (!sql || sql.toUpperCase().startsWith('IMPOSIBLE')) {
    return null;
  }

  const res = await ejecutarSqlDatos(supabase, sql);
  if (!res.ok) {
    return (
      'No he podido calcular eso con los datos que tengo cargados. ' +
      'Si me lo planteas de otra forma, lo intento de nuevo.'
    );
  }

  const tabla = formatearResultado(res.rows);
  try {
    const redac = await chat(`${conContexto(pregunta, historial)}\n\nRESULTADOS:\n${tabla}`, {
      system: RESPUESTA_PROMPT,
      tier: 'fast',
      temperature: 0,
      max_tokens: 800,
    });
    return redac.text || `Esto es lo que sale de los datos:\n\n${tabla}`;
  } catch {
    return `Esto es lo que sale de los datos:\n\n${tabla}`;
  }
}
