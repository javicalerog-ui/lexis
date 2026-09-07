# GUÍA — Aplicar el motor de datos (Build 2) + rol admin · 2026-09-08

**Resultado final:** el schema `datos` (8 tablas + vista) y la barrera de aislamiento quedan creados en Supabase, y tu cuenta queda como admin. Con esto puedo construir el cargador que mete los 119k registros.
**Tiempo estimado:** 10-12 min · **Necesitas:** Supabase logueado con **`javier.calero@porcelanosagrupo.com`**, proyecto **`cvtbzxeizdaihyitbphh`**.

> Todos los pasos son en **SQL Editor** del proyecto de Lexis. Antes de empezar, confirma en la URL que estás en `.../project/cvtbzxeizdaihyitbphh/...`.

---

## Fase 1 — Crear el schema de datos (tablas vacías)

### Paso 1 — Pega y ejecuta la migración del schema
1. Abre en tu PC el fichero:
   `C:\Users\ES00500148\Desktop\Proyectos IA\10-lexis-segundo-cerebro\supabase_migrations\20260908000100_datos_schema.sql`
   (clic derecho → Abrir con → Bloc de notas, o ábrelo en VS Code).
2. Selecciona todo (**Ctrl+A**) y copia (**Ctrl+C**).
3. En Supabase → **SQL Editor** → **New query**, pega (**Ctrl+V**) y pulsa **Run**.

✅ Verás: «**Success. No rows returned**». Crea 8 tablas + la vista `ventas_pais` + índices, todo vacío por ahora.
⚠️ Si ves un error de que algo «already exists»: dímelo y lo miro — puede que se aplicara a medias.

### Paso 2 — Comprueba que las tablas están
1. New query, pega y Run:

```sql
select table_name
from information_schema.tables
where table_schema = 'datos'
order by table_name;
```

✅ Verás 7 tablas: `dim_cobertura, dim_pais, espana_provincial, mercado_intl, mercado_provincial, proveedores, venta_sociedad, venta_terceros` (la vista `ventas_pais` sale aparte). Con que veas la lista, perfecto.

---

## Fase 2 — Crear la barrera de aislamiento + probarla

### Paso 3 — Pega y ejecuta la migración del rol
1. Abre el fichero:
   `C:\Users\ES00500148\Desktop\Proyectos IA\10-lexis-segundo-cerebro\supabase_migrations\20260908000200_datos_ro_role.sql`
2. **Ctrl+A**, **Ctrl+C**.
3. SQL Editor → New query → pega → **Run**.

✅ Verás: «**Success. No rows returned**». Crea el rol `datos_ro` y la función `datos_run_query`.
⚠️ Si ves un error con «role datos_ro» o «permission denied»: cópiamelo entero y paro aquí contigo — es la parte más delicada y prefiero verlo antes de reintentar.

### Paso 4 — Prueba de humo (que el aislamiento funciona de verdad)
Vas a ejecutar 3 consultas. La 1ª debe funcionar; la 2ª y la 3ª deben **fallar** — y que fallen es precisamente el éxito.

**4a.** New query, pega y Run:
```sql
select public.datos_run_query('select 1 as ok');
```
✅ Verás: `[{"ok":1}]`. La función responde.

**4b.** New query, pega y Run:
```sql
select public.datos_run_query('select * from public.memories');
```
✅ Verás un **ERROR** que dice algo como `permission denied for table memories`. **Eso es lo correcto**: significa que aunque una consulta intente leer tus memorias personales, no puede. Si en vez de error devolviera datos, avísame de inmediato.

**4c.** New query, pega y Run:
```sql
select public.datos_run_query('delete from datos.mercado_intl');
```
✅ Verás un **ERROR** `solo se permiten consultas SELECT/WITH`. Correcto: no deja escribir.

Con 4a devolviendo el 1 y 4b/4c dando error, el aislamiento está verificado.

---

## Fase 3 — Ponerte a ti como administrador

### Paso 5 — Localiza tu usuario
1. New query, pega y Run:
```sql
select id, email, raw_app_meta_data
from auth.users
order by created_at;
```
✅ Verás la lista de usuarios (hoy, solo el tuyo). Fíjate en tu **email** — lo necesitas en el paso siguiente.

### Paso 6 — Márcate como admin
1. New query. En la línea de abajo, **sustituye `<TU-EMAIL>`** por el email exacto que viste en el Paso 5, pega y Run:
```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = '<TU-EMAIL>';
```

| Placeholder | De dónde sale |
|---|---|
| `<TU-EMAIL>` | El email de tu fila en el resultado del Paso 5 |

✅ Verás: «Success. **1 row(s) affected**». Si dice 0 rows, el email no coincidía — revísalo y repite.

### Paso 7 — Confirma
1. New query, pega y Run:
```sql
select email, raw_app_meta_data ->> 'role' as rol
from auth.users
where raw_app_meta_data ->> 'role' is not null;
```
✅ Verás tu email con `rol = admin`. (Nota: para que tu sesión abierta lo note, tendrás que cerrar y volver a entrar en Lexis alguna vez — pero no corre prisa, aún no hay pantalla de admin que lo use.)

---

## Fase 4 — Alta de Silvestre (CUANDO LO TENGAS DELANTE, no ahora)

Esto es mejor hacerlo con él presente, para que teclee su contraseña, instale la PWA y active las notificaciones de una sentada. **Cuando estés con él, avísame y te doy esta fase con el detalle** (crear usuario con "Add user" + Auto Confirm, fijar contraseña fuerte, y un par de ajustes SQL que dependen de que su cuenta ya exista: su modo de vista simplificada y desactivarle el digest por email). No lo hagas suelto ahora.

---

## Al terminar (Fases 1-3)
Dime «hecho» y verifico yo el resto por mi parte. Con el schema y el aislamiento en su sitio, arranco el cargador de datos (`cargar_supabase.py`): cuando esté, meter los 119k registros será un único comando tuyo.
