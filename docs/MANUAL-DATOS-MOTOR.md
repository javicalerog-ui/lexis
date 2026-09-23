# MANUAL DEL MOTOR DE DATOS DE LEXIS

> **Para qué sirve este documento.** Responde a: *"me han llegado datos nuevos — ¿dónde los guardo, cómo los subo, y quién podrá consultarlos?"*
> Escrito para leerlo sin acordarse de nada previo. Si eres una conversación nueva de Claude: esto es la fuente de verdad operativa del motor de datos; léelo entero antes de tocar cargas.
>
> **Verificado:** 2026-09-23 · **Ruta:** `C:\Users\ES00500148\Desktop\Proyectos IA\10-lexis-segundo-cerebro\docs\MANUAL-DATOS-MOTOR.md`

---

## 1 · Quién ve qué (verificado 2026-09-23)

| Tabla | Javi | Silvestre | Jose María |
|---|:-:|:-:|:-:|
| `mercado_intl` (Ascer/Confindustria/Porcelanosa) | ✅ | ✅ | ✅ |
| `mercado_provincial` | ✅ | ✅ | ✅ |
| `espana_provincial` | ✅ | ✅ | ✅ |
| `venta_sociedad` (filiales propias) | ✅ | ✅ | ✅ |
| `venta_terceros` (exportación directa) | ✅ | ✅ | ✅ |
| `dim_cobertura` · `dim_pais` | ✅ | ✅ | ✅ |
| `proveedores` (compras) | ✅ | ✅ | ❌ |
| `hpe_propuestas` (propuestas hoteleras) | ✅ | ❌ | ✅ |
| `gd_contactos` (204k contactos B2B) | ✅ | ❌ | ✅ |

**Cuentas:** Javi `gpjcalero@gmail.com` · Silvestre `ssegarra@porcelanosa.com` · Jose María `jmsegarra@porcelanosagrupo.com`

**Para comprobar esto en cualquier momento** (SQL Editor de Supabase, proyecto `cvtbzxeizdaihyitbphh`):

```sql
select u.email, t.tabla, datos.tiene_acceso(t.tabla, u.id) as acceso
from (values
  ('mercado_intl'),('mercado_provincial'),('espana_provincial'),
  ('venta_sociedad'),('venta_terceros'),('dim_cobertura'),('dim_pais'),
  ('proveedores'),('hpe_propuestas'),('gd_contactos')
) as t(tabla)
cross join (select id, email from auth.users) as u
where u.email in ('gpjcalero@gmail.com','ssegarra@porcelanosa.com','jmsegarra@porcelanosagrupo.com')
order by u.email, t.tabla;
```

---

## 2 · Preparación común a TODAS las cargas

Los tres cargadores necesitan lo mismo. Abre PowerShell y ejecuta **en la misma ventana** donde vayas a lanzar la carga:

```powershell
cd "C:\Users\ES00500148\Desktop\Proyectos IA\10-lexis-segundo-cerebro"
$env:SUPABASE_URL='https://cvtbzxeizdaihyitbphh.supabase.co'
$env:HTTPS_PROXY='http://172.22.1.121:8080'; $env:HTTP_PROXY='http://172.22.1.121:8080'
```

Y la clave de servicio, que **nunca se escribe en el chat**:

1. Abre `https://supabase.com/dashboard/project/cvtbzxeizdaihyitbphh/settings/api-keys`
2. Fila **`service_role`** → **«Reveal»** → copia el texto largo (empieza por `eyJ`)
3. En PowerShell: `$env:SUPABASE_SERVICE_KEY='<pega aquí con Ctrl+V>'`

**⚠️ Verifica SIEMPRE antes de lanzar** (este error ha pasado 3 veces — se queda el texto de ejemplo sin sustituir):

```powershell
"Longitud: $($env:SUPABASE_SERVICE_KEY.Length)"
```

✅ Debe salir **~219**. Si sale 22 o 29, es el placeholder: repite el paso 3.

---

## 3 · Las tres fuentes: dónde va cada cosa

### 3.1 · Datos de negocio de Silvestre (Ascer, Confindustria, ventas, proveedores)

| | |
|---|---|
| **Alimenta** | `mercado_intl`, `mercado_provincial`, `espana_provincial`, `proveedores`, `venta_sociedad`, `venta_terceros`, `dim_cobertura`, `dim_pais` |
| **Carpeta** | `C:\Users\ES00500148\Desktop\Proyectos IA\05-ia-encargos-grupo\silvestre-gpts\data\` |
| **Ficheros** | `Ascer_nac_exp_y_Confindustria.xlsx` · `España Ascer y Porcelanosa.xlsx` · `Proveedores.xlsx` · `Venta por sociedad.xlsx` · `Venta terceros.xlsx` |
| **Cadencia** | Mensual (las fuentes las recoges tú de Ximo / JC Cortés / PICOPA / SAP — ver `project-silvestre-gpts-fuentes-sop`) |
| **Aviso automático** | Día 1 de cada mes a las 8:00 (regla `Recarga mensual datos Silvestre`) |

**Cómo cargar** (sustituye el fichero viejo por el nuevo en la carpeta, con el MISMO nombre, y lanza):

```powershell
python _scripts\cargar_supabase.py
```

✅ Termina con «OK. Datos cargados en el schema `datos` de Supabase.»

**Si llegan datos de ASCER (o cualquiera de los 5) fuera de fecha:** es exactamente el mismo procedimiento. Reemplaza el Excel y relanza el comando — no hay que esperar al día 1. La carga es completa (borra y reinserta todo), así que no duplica nada.

**Comprobación tras cargar:**
```sql
select datos.run_query('select round(sum(eur)::numeric,2) as t from ventas_pais where pais_norm=''francia'' and anio=2025',
  (select id from auth.users where email='gpjcalero@gmail.com'));
```
✅ Referencia conocida: Francia 2025 = **56.953.780,72 €** (si cambia, es que los datos nuevos traen cambios — no necesariamente un error, pero conviene saberlo).

---

### 3.2 · Propuestas hoteleras (HPE)

| | |
|---|---|
| **Alimenta** | `hpe_propuestas` |
| **Carpeta** | `C:\Users\ES00500148\Desktop\Proyectos IA\01-ibd-mercados-gtm\hotel-proposal-engine\data\proyectos\` |
| **Ficheros** | Un `.json` por propuesta (hoy: `melia-white-sands.json`) |
| **Cadencia** | Por evento — cuando se estructura una propuesta nueva |
| **Aviso automático** | Lunes a las 8:00 (regla `Revisión semanal HPE`) |

**Cómo cargar:**

```powershell
python _scripts\cargar_hpe.py
```

✅ Lista cada propuesta leída y termina con «OK. Cargado en datos.hpe_propuestas.»

**El cargador lee TODOS los `.json` de esa carpeta.** Si HPE estructura una propuesta nueva, entra sola en la siguiente carga — no hay que tocar código.

**Qué sube y qué NO:** solo resumen editorial (estado, fase de obra, ventana de prescripción, prioridad, próxima acción, marca líder). **Nunca** cifras de coste, margen ni viabilidad interna — norma fijada para audiencia comercial.

---

### 3.3 · Contactos de Global Database

| | |
|---|---|
| **Alimenta** | `gd_contactos` (204.142 contactos a 2026-09-23) |
| **Carpeta** | `C:\Users\ES00500148\Desktop\Proyectos IA\01-ibd-mercados-gtm\ibd-zero\data\market-reference\sources\global-database\` |
| **Ficheros** | Cualquier `.xlsx` exportado de la plataforma GD, con el nombre que sea |
| **Cadencia** | Por evento — cuando descargas exports nuevos |
| **Aviso automático** | Ninguno (depende de cuándo operes la plataforma) |

**Cómo se obtienen los datos:** GD **no tiene API de exportación masiva**. Hay que entrar a su plataforma web, buscar con la *recipe* del país correspondiente y descargar el Excel. Las recipes ya están generadas en:
`...\ibd-zero\gd-harvest\out\recipes\<pais>.md` y el plan de olas en `out\ola1_plan.md`.

**Cómo cargar** (deja el `.xlsx` descargado en la carpeta de arriba y lanza):

```powershell
python _scripts\cargar_gd.py
```

✅ Lista cada fichero con sus contactos nuevos y termina con «OK. Cargado en datos.gd_contactos.» (tarda varios minutos por el volumen)

**Deduplica solo:** si descargas dos veces el mismo país, o guardas el mismo export con dos nombres, no se duplica (la clave es empresa+nombre+apellido+cargo+email).

**Qué sube:** nombre, apellido, cargo, seniority, departamento, empresa, país, ciudad, industria, web, LinkedIn, teléfono y email directo. **No sube** datos financieros de la empresa (facturación, beneficio, activos) — fuera del alcance de "a quién contacto".

---

## 4 · Si llega una fuente NUEVA que no está en este manual

Ejemplo: un Excel de una fuente que hoy no existe en el motor. El procedimiento completo, en orden:

**1. Crear la tabla y darla de alta en el motor** (SQL Editor):

```sql
create table if not exists datos.<nombre_tabla> (
  id bigint generated always as identity primary key,
  -- ...columnas...
);

select datos.registrar_tabla('<nombre_tabla>');
```

> `registrar_tabla` hace 3 cosas imprescindibles: activa RLS, crea la política de permisos y da escritura al cargador. **Sin esto, la tabla no funciona en el motor.**

**2. Conceder acceso a quien corresponda:**

```sql
select datos.dar_acceso('<nombre_tabla>', e)
from unnest(array['jmsegarra@porcelanosagrupo.com','gpjcalero@gmail.com']) as e;
```

**3. Describir la tabla al modelo** — editar `src/lib/datos/schema-prompt.ts`, añadiendo una entrada en `TABLAS_ESQUEMA` con las columnas **y los comentarios de negocio** (qué significa cada cosa, qué trampas tiene). Sin esto, el chat no sabe que la tabla existe.

**4. Escribir el cargador** en `_scripts/cargar_<fuente>.py` — copiar el patrón de `cargar_hpe.py` (el más simple) o `cargar_gd.py` (si hay que leer varios ficheros y deduplicar).

**5. Desplegar** (los cambios de `schema-prompt.ts` necesitan estar en producción):

```powershell
cd "C:\Users\ES00500148\Desktop\Proyectos IA\10-lexis-segundo-cerebro"; $env:HTTPS_PROXY='http://172.22.1.121:8080'; git push javicalerog-ui main
```

**6. Cargar** y verificar con `datos.run_query` que devuelve datos.

---

## 5 · Avisos automáticos activos

| Aviso | Cuándo | Qué hace |
|---|---|---|
| `Revisión semanal HPE` | Lunes 8:00 | Push: "¿Hay alguna propuesta hotelera nueva que cargar?" |
| `Recarga mensual datos Silvestre` | Día 1, 8:00 | Push: "¿Ya tienes los Excels del mes? Relanza `cargar_supabase.py`" |

**Cómo añadir uno nuevo** (SQL Editor, cambiando nombre/cron/mensaje):

```sql
insert into proactive_rules (user_id, kind, name, description, trigger_type, trigger_config, action_type, action_payload)
values (
  (select id from auth.users where email='gpjcalero@gmail.com'),
  'custom', '<Nombre>', '<Descripción>',
  'cron', '{"cron":"0 8 * * 1"}',   -- minuto hora día mes día-semana (1=lunes)
  'push_simple',
  '{"title":"<Título>","body":"<Mensaje>","url":"/asistente"}'
);
update proactive_rules set next_due_at = now() where name = '<Nombre>';
```

**Quién los dispara:** dos latidos independientes, cada 15 minutos:
- GitHub Actions `.github/workflows/reminders-cron.yml` (llama a `/api/cron/reminders` **y** `/api/cron/proactive`) — se puede comprobar en la pestaña Actions del repo `javicalerog-ui/lexis`
- Worker de Cloudflare `acta.gpjcalero.workers.dev` (solo recordatorios; salud desconocida, redundante)

---

## 6 · Trampas conocidas (cosas que ya han fallado)

| Síntoma | Causa real | Solución |
|---|---|---|
| `401 Invalid token` / `Longitud: 22` | El placeholder `<PEGA-LA-SERVICE-ROLE>` quedó sin sustituir | Verificar la longitud (~219) antes de lanzar |
| `git push` pide contraseña | `gh` volvió a la cuenta `gpjcalero`; GitHub no acepta contraseñas | `gh auth switch -u javicalerog-ui` y reintentar. **Nunca teclear una contraseña ahí** |
| `syntax error at or near "cd"` | Comando de PowerShell pegado en el SQL Editor | PowerShell va en PowerShell, SQL en Supabase |
| `404` al cargar una tabla recién creada | PostgREST no ha refrescado su caché | `notify pgrst, 'reload schema';` y esperar 15s |
| `403 Forbidden` al cargar | La tabla no pasó por `registrar_tabla` (le falta el permiso de escritura) | Ejecutar `select datos.registrar_tabla('<tabla>');` |
| El chat responde pero no ve una tabla concedida | La política de la tabla se creó con una versión antigua de `registrar_tabla` | Volver a ejecutar `select datos.registrar_tabla('<tabla>');` (borra y recrea la política) |
| El cargador tarda "demasiado" | GD son 204k filas | Normal: varios minutos. Dejarlo terminar |

---

## 7 · Pendientes conocidos

- **ICB (battlecards/competencia):** bloqueado — el sistema que debe rellenarlos nunca se encendió. Se trabaja en su propia conversación (ver `03-inteligencia-competitiva\icb-vertical\docs\HOJA-DE-RUTA-BCI-2026-08-21.md`).
- **GD:** faltan por descargar los países de la ola 1 que aún no tienen export (ver `gd-harvest\out\ola1_plan.md`).
- **Semestral:** cuando se cierre el 6º Excel de Silvestre, añadirlo a `cargar_supabase.py`.
