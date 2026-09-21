// =====================================================
// Descripción del schema `datos` para el LLM (equivalente a esquema_texto()
// de Clavis). Es lo ÚNICO que ve el modelo — nunca datos. Incluye los mismos
// comentarios de negocio que en Clavis (perímetros de cuota, huecos, canales),
// porque son lo que evita respuestas plausibles pero falsas.
//
// MULTIUSUARIO (2026-09-18): el esquema se monta POR USUARIO con solo las
// tablas que le concede datos.acl — un usuario sin permiso sobre una tabla ni
// siquiera sabe que existe. La vista ventas_pais solo se enseña si el usuario
// puede ver sus dos tablas base (venta_terceros + venta_sociedad).
//
// La cobertura temporal (dim_cobertura) se añade en tiempo de ejecución (qa.ts)
// con una consulta, para que refleje siempre hasta dónde llega cada serie.
// =====================================================

export const TABLAS_ESQUEMA: Record<string, string> = {
  mercado_intl: `TABLA mercado_intl
  -- Exportacion mensual por pais y fuente, en euros y metros cuadrados.
  -- fuente='Ascer' = exportacion TOTAL del sector ceramico espanol (incluye a
  -- Porcelanosa dentro); 'Confindustria' = sector ceramico italiano (competidor);
  -- 'Porcelanosa' = exportacion DIRECTA del grupo a clientes terceros.
  -- *** PERIMETRO CRITICO: la serie 'Porcelanosa' NO incluye lo que venden las
  -- filiales propias (venta_sociedad), que suma un importe similar. Una cuota
  -- calculada solo con esta tabla INFRAESTIMA a la mitad (2025: 6,6% vs ~13,6%
  -- sumando filiales). Al dar una cuota, advertirlo o sumar venta_sociedad. ***
  -- Precio medio (eur/mt2) SI es comparable entre las tres fuentes.
  -- HUECO: en Ascer NO existe julio de 2025 (agosto engloba jul+ago).
    fuente text
    pais text
    pais_norm text
    anio integer
    mes text
    mes_num integer
    mt2 numeric
    eur numeric
    periodo integer`,

  mercado_provincial: `TABLA mercado_provincial
  -- Venta ANUAL por provincia espanola (Ascer = sector, Porcelanosa = propia).
  -- No tiene detalle mensual.
    fuente text
    provincia text
    provincia_norm text
    cod_ine integer
    comunidad text
    anio integer
    mt2 numeric
    eur numeric`,

  espana_provincial: `TABLA espana_provincial
  -- Mercado nacional ESPANOL por provincia y ano (52 provincias x 2022-2026),
  -- con Ascer y Porcelanosa en columnas paralelas (cuota provincial directa).
  -- Solo dato ANUAL: no hay mes, no calcular YTD. HUECOS reales (son 'sin dato',
  -- nunca cero): 2022 sin ascer_mt2; 2026 sin columnas Ascer y Porcelanosa solo
  -- 48 de 52 provincias; ascer_eur 2022 redondeado a miles.
    anio integer
    cod_ine integer
    provincia text
    provincia_norm text
    ascer_mt2 numeric
    ascer_eur numeric
    porcelanosa_mt2 numeric
    porcelanosa_eur numeric`,

  proveedores: `TABLA proveedores
  -- COMPRAS a proveedores por acreedor, ramo y mes (2017 en adelante). Es gasto,
  -- NO venta: nunca sumar con las tablas de venta. Sin pais ni marca.
    acreedor bigint
    empresa text
    ramo text
    anio integer
    mes_num integer
    mes text
    valor_eur numeric
    periodo integer`,

  venta_sociedad: `TABLA venta_sociedad
  -- Venta propia por filial, organizacion, oficina y marca. ATENCION:
  -- pais_filial es el domicilio de la filial, NO el destino de la venta.
  -- marca solo tiene Porcelanosa, Xlight y Xtone (centro de beneficio).
    sociedad text
    org_ventas text
    of_ventas text
    marca text
    pais_filial text
    pais_filial_norm text
    anio integer
    mes text
    mes_num integer
    mt2 numeric
    eur numeric
    periodo integer`,

  venta_terceros: `TABLA venta_terceros
  -- Exportacion a clientes terceros por pais y cliente (2022 en adelante).
  -- Excluye Espana. 'cliente' es nombre real. Sirve para rankings y cartera.
    sociedad text
    pais text
    pais_norm text
    cliente text
    anio integer
    mes text
    mes_num integer
    eur numeric
    mt2 numeric
    periodo integer`,

  dim_cobertura: `TABLA dim_cobertura
  -- Hasta que periodo (AAAAMM) llega cada serie. Consultar antes de comparar
  -- acumulados entre fuentes distintas.
    tabla text
    fuente text
    periodo_min integer
    periodo_max integer
    filas integer`,

  dim_pais: `TABLA dim_pais
  -- Nombre canonico de cada pais (pais_norm -> pais_display).
    pais_norm text
    pais_display text`,

  hpe_propuestas: `TABLA hpe_propuestas
  -- Resumen editorial de propuestas hoteleras (Hotel Proposal Engine). Una fila
  -- por proyecto. NUNCA hay cifras de coste/margen/viabilidad interna en esta
  -- tabla (norma comercial: a JM solo estado + accion, nunca numeros crudos).
  -- ventana_prescripcion='ABIERTA' es la senal mas accionable: significa que
  -- es el momento de prescribir materiales AHORA. proxima_accion es el
  -- siguiente paso sugerido (confirmar con quien, que falta, etc).
    propuesta_id text
    nombre text
    ubicacion text
    pais text
    categoria_estrellas integer
    tipologia text
    llaves integer
    estado text
    apertura text
    fase_obra text
    ventana_prescripcion text
    prioridad text
    proxima_accion text
    marca_lider text
    marcas_complementarias text
    fuente text`,
};

const VISTA_VENTAS_PAIS = `VISTA ventas_pais
  -- ⭐ USA ESTA VISTA para "cuanto vendimos en <pais>". Une los DOS canales:
  -- exportacion directa a terceros + venta de filiales propias. Da SIEMPRE el
  -- TOTAL y el desglose por canal (columna canal = 'Exportacion directa' |
  -- 'Filial propia'). Ej: Francia 2025 = 20,6 + 36,4 = 56,9 MEUR. NO la uses
  -- para cuota frente a Ascer (esa va contra mercado_intl).
    pais text
    pais_norm text
    anio integer
    mes text
    mes_num integer
    periodo integer
    canal text
    eur numeric
    mt2 numeric`;

/** Nombres consultables si el usuario tiene esas tablas concedidas. */
export function tablasConsultables(concedidas: string[]): string[] {
  const set = new Set(concedidas.filter((t) => t in TABLAS_ESQUEMA));
  const out = [...set];
  if (set.has('venta_terceros') && set.has('venta_sociedad')) {
    out.push('ventas_pais');
  }
  return out;
}

/** Monta el texto de esquema para el LLM con SOLO las tablas concedidas. */
export function esquemaParaTablas(concedidas: string[]): string {
  const set = new Set(concedidas);
  const partes = Object.entries(TABLAS_ESQUEMA)
    .filter(([nombre]) => set.has(nombre))
    .map(([, texto]) => texto);
  if (set.has('venta_terceros') && set.has('venta_sociedad')) {
    partes.push(VISTA_VENTAS_PAIS);
  }
  return partes.join('\n\n');
}

/** Esquema completo (todas las tablas): para el admin y usos internos. */
export const ESQUEMA_DATOS = esquemaParaTablas(Object.keys(TABLAS_ESQUEMA));
