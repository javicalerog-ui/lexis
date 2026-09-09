# GUÍA — Poner en marcha Lexis para Silvestre (motor de datos + su chat) · 2026-09-09

**Resultado final:** Lexis desplegado con la pantalla única de Silvestre, los ~133.000 registros de negocio cargados y verificados (no miente), su cuenta creada con contraseña, y la PWA instalada en su iPhone.
**Tiempo estimado:** 45-60 min · **Necesitas:** tu PC con PowerShell, sesión en Supabase (proyecto lexis, org Porcelanosa), y el iPhone de Silvestre para el final.

## Antes de empezar

| Placeholder | Dónde se consigue |
|---|---|
| `<EMAIL-SILVESTRE>` | El email que Silvestre usa en su iPhone (pregúntaselo; será su usuario de entrada). |
| `<CONTRASEÑA-SILVESTRE>` | La acordáis entre vosotros. **No me la digas nunca por el chat.** |
| service_role key | Paso 8; se copia de Supabase a tu PowerShell directamente, **jamás al chat**. |

Notas:
- Cuenta Supabase: entra con **la cuenta de siempre del proyecto lexis (org Porcelanosa)** — el proyecto es `cvtbzxeizdaihyitbphh`. Si dudas de cuál es, míralo en el inventario de cuentas (`00-sistema-metodo\cuentas\`).
- El conector Supabase de Claude solo ve tu otra org (la personal), por eso estos pasos son tuyos.
- Todos los comandos son PowerShell 5.1 (sin `&&`) y funcionan tras el proxy corporativo.

---

## Fase 1 — Desplegar el código (pasos 1-2) · ~5 min

### Paso 1 — Push de los 3 commits

En tu PowerShell:

```powershell
cd "C:\Users\ES00500148\Desktop\Proyectos IA\10-lexis-segundo-cerebro"
```

```powershell
$env:HTTPS_PROXY='http://172.22.1.121:8080'; git push javicalerog-ui main
```

✅ Verás: unas líneas que terminan en `main -> main` sin errores (sube todo el go-live: motor de datos, chat de Silvestre, captura-todo y esta guía).
⚠️ Si pide usuario/contraseña o da error de autenticación: dime el mensaje exacto y lo resolvemos (NO pegues credenciales en el chat).
⚠️ **No hagas push a `origin`** — solo a `javicalerog-ui` (origin tiene un commit divergente del workflow que gestionamos aparte).

### Paso 2 — Confirmar que Vercel desplegó

1. Espera ~2 minutos.
2. Abre `https://lexis-jade.vercel.app` en el navegador.

✅ Verás: la pantalla de login de Lexis carga normal.
⚠️ Si ves un error de Vercel: entra en el dashboard de Vercel (cuenta javicalerog-ui) → proyecto lexis → «Deployments» y dime qué estado tiene el último.

**Dime «deploy ok» y yo verifico el endpoint por mi cuenta antes de seguir.**

---

## Fase 2 — Base de datos: migraciones + candado (pasos 3-6) · ~10 min

### Paso 3 — Migración de IDs (para el cargador)

1. Entra en `https://supabase.com/dashboard/project/cvtbzxeizdaihyitbphh/sql/new` — con **la cuenta del proyecto lexis**.
2. Pega esto y pulsa «Run» (abajo a la derecha, o Ctrl+Enter):

```sql
alter table datos.mercado_intl        add column if not exists id bigint generated always as identity primary key;
alter table datos.mercado_provincial  add column if not exists id bigint generated always as identity primary key;
alter table datos.espana_provincial   add column if not exists id bigint generated always as identity primary key;
alter table datos.proveedores         add column if not exists id bigint generated always as identity primary key;
alter table datos.venta_sociedad      add column if not exists id bigint generated always as identity primary key;
alter table datos.venta_terceros      add column if not exists id bigint generated always as identity primary key;
alter table datos.dim_cobertura       add column if not exists id bigint generated always as identity primary key;
```

✅ Verás: «Success. No rows returned».
⚠️ Si ves «already exists»: ya estaba aplicada; sigue al paso 4.

### Paso 4 — Migración de la capa segura de consulta

En la misma pantalla del SQL Editor, borra lo anterior, pega esto y «Run»:

```sql
-- Capa de consulta segura del motor de datos (rol datos_ro + run_query)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'datos_ro') then
    create role datos_ro nologin;
  end if;
end $$;

grant datos_ro to postgres;

grant usage on schema datos to datos_ro;
grant select on all tables in schema datos to datos_ro;
alter default privileges in schema datos grant select on tables to datos_ro;

create or replace function datos.run_query(p_sql text)
returns jsonb
language plpgsql
security definer
set search_path = datos, pg_temp
as $$
declare
  result jsonb;
  clean  text := btrim(p_sql);
begin
  if lower(clean) !~ '^(select|with)\s' then
    raise exception 'datos.run_query: solo se permiten consultas SELECT/WITH';
  end if;
  if position(';' in clean) > 0 then
    raise exception 'datos.run_query: no se permiten multiples sentencias (;)';
  end if;

  set local role datos_ro;
  set local statement_timeout = '5000';
  set local default_transaction_read_only = on;

  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) '
    'from (select * from (%s) _q limit 200) t',
    clean
  ) into result;

  return result;
end;
$$;

revoke all on function datos.run_query(text) from public;
grant execute on function datos.run_query(text) to service_role;
```

✅ Verás: «Success. No rows returned».

### Paso 5 — Prueba de humo del candado (importante, 30 segundos)

En el SQL Editor, pega y «Run» (las 2 juntas no — **de una en una**):

Primera:

```sql
select datos.run_query('select 1 as ok');
```

✅ Verás: `[{"ok":1}]`.

Segunda:

```sql
select datos.run_query('select * from public.memories');
```

✅ Verás: **ERROR «permission denied for table memories»** — esto es LO BUENO: demuestra que el motor de Silvestre no puede tocar tus memorias aunque el SQL lo intente.
⚠️ Si esta segunda NO da error: párate y avísame — no seguimos hasta arreglarlo.

### Paso 6 — Exponer el schema `datos` a la API

1. Entra en `https://supabase.com/dashboard/project/cvtbzxeizdaihyitbphh/settings/api`.
2. Busca la sección «Data API» → campo «Exposed schemas» (verás `public, graphql_public`…).
3. Añade `datos` a la lista **sin quitar los que ya están**.
4. Pulsa «Save».

✅ Verás: aviso de guardado correcto.

---

## Fase 3 — Cargar los ~133.000 registros (pasos 7-9) · ~15 min

### Paso 7 — Copiar la service_role key

1. En la misma página de Settings → «API Keys», localiza la fila **service_role**.
2. Pulsa «Reveal» y cópiala al portapapeles.

✅ La tienes en el portapapeles. **No la pegues en el chat en ningún caso.**

### Paso 8 — Preparar el entorno y lanzar el cargador

En PowerShell (pega la clave donde marca el placeholder — es TU pantalla, no el chat):

```powershell
$env:SUPABASE_URL='https://cvtbzxeizdaihyitbphh.supabase.co'; $env:SUPABASE_SERVICE_KEY='<PEGA-AQUI-LA-SERVICE-ROLE>'; $env:HTTPS_PROXY='http://172.22.1.121:8080'; $env:HTTP_PROXY='http://172.22.1.121:8080'
```

```powershell
cd "C:\Users\ES00500148\Desktop\Proyectos IA\10-lexis-segundo-cerebro"; python _scripts\cargar_supabase.py
```

✅ Verás: va imprimiendo tabla a tabla (`mercado_intl: X filas`, lotes `800/…`) y termina con **«OK. Datos cargados en el schema `datos` de Supabase.»** Tarda varios minutos — déjalo acabar.
⚠️ Si ves `ERROR: define SUPABASE_URL...`: el primer comando no se ejecutó en esta misma ventana — repítelo.
⚠️ Si ves `HTTP 404` en la primera tabla: el paso 6 (exponer schema) no está guardado — vuelve a él.
⚠️ Si ves `PGRST` u otro HTTP raro: pégame el mensaje (sin la clave) y lo miro.

### Paso 9 — Verificar la cifra de fuego en la base

En el SQL Editor (`.../sql/new`), pega y «Run»:

```sql
select datos.run_query('select round(sum(eur)::numeric,2) as total_francia_2025 from ventas_pais where pais_norm = ''francia'' and anio = 2025');
```

✅ Verás: `[{"total_francia_2025": 56953780.72}]` — la cifra exacta que validamos contra tu Excel.
⚠️ Si sale otra cifra o vacío: **para aquí** y pégame lo que salió.

---

## Fase 4 — La cuenta de Silvestre (pasos 10-11) · ~5 min

### Paso 10 — Crear el usuario

1. Entra en `https://supabase.com/dashboard/project/cvtbzxeizdaihyitbphh/auth/users`.
2. Pulsa «Add user» (arriba a la derecha) → «Create new user».
3. Rellena:
   - Email: `<EMAIL-SILVESTRE>`
   - Password: `<CONTRASEÑA-SILVESTRE>`
   - Marca **«Auto Confirm User»** (imprescindible: su email no puede recibir el correo de confirmación).
4. Pulsa «Create user».

✅ Verás: el email aparece en la lista de usuarios.

### Paso 11 — Activarle el modo Silvestre + acceso a datos

En el SQL Editor, pega (cambiando el email) y «Run»:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || '{"ui_mode":"simple","datos_access":true}'::jsonb
where email = '<EMAIL-SILVESTRE>'
returning email, raw_app_meta_data;
```

✅ Verás: 1 fila con su email y un JSON que incluye `"ui_mode": "simple"` y `"datos_access": true`.
⚠️ Si devuelve 0 filas: el email no coincide con el del paso 10 (mayúsculas/espacios) — corrígelo y repite.

---

## Fase 5 — Preguntas de fuego en la app (paso 12) · ~10 min · ANTES de dárselo

### Paso 12 — Entrar como Silvestre y probar

1. Abre una **ventana de incógnito** → `https://lexis-jade.vercel.app`.
2. Entra con `<EMAIL-SILVESTRE>` + su contraseña.

✅ Verás: entra **directo a la pantalla del chat** (una sola ventana: «Lexis» arriba, saludo, caja de texto abajo). 
⚠️ Si ves el Lexis completo con menús: el paso 11 no aplicó — avísame.

3. Haz estas 4 pruebas, una a una:

| # | Escribe | ✅ Debe pasar |
|---|---|---|
| 1 | `¿Cuánto vendimos en Francia en 2025?` | Total ≈ **56,95 M€** con desglose por canal (≈20,6 directa + ≈36,4 filial). |
| 2 | `¿Cuál es nuestra cuota en Francia?` | Da la cuota **con el aviso de perímetro** (total vs comparable) — no una cifra seca. |
| 3 | `¿Cuánto vendimos en Marte?` | Dice que **no tiene ese dato**. No inventa. |
| 4 | `Apunta que mañana pruebo Lexis con Silvestre` | Responde **«Anotado: …»** con un resumen. |

⚠️ Si cualquiera falla: pégame la pregunta y la respuesta tal cual, y NO le des la app hasta que lo cerremos.

---

## Fase 6 — El iPhone de Silvestre (paso 13) · ~5 min

### Paso 13 — Instalar la PWA

Con su iPhone delante:

1. Abre **Safari** (tiene que ser Safari) → `lexis-jade.vercel.app`.
2. **Primero haz login** con su email y contraseña (así la app instalada ya entra sola).
3. Pulsa el botón **compartir** (el cuadrado con la flecha hacia arriba, abajo en el centro).
4. Baja en la lista y pulsa **«Añadir a pantalla de inicio»** → «Añadir» (arriba a la derecha).

✅ Verás: el icono de Lexis en su pantalla de inicio; al abrirlo, pantalla completa con su chat.
⚠️ Si al abrir la PWA pide login otra vez: no pasa nada — que entre una vez con su contraseña y ya queda.

---

## Al terminar

Dime **«todo verde»** (o en qué paso te has quedado) y yo:
1. Verifico el endpoint desplegado por mi cuenta.
2. Cierro el estado del proyecto y dejamos anotado qué queda para después.

**Pendientes que NO bloquean el estreno** (para los próximos días):
- Añadir el **semestral** (6º Excel) al motor cuando lo cierres en la otra conversación.
- Fiches de contexto ASCER/Confindustria + info de empresa.
- Re-lanzar tu carga de proyectos hasta 0 fallidas.
- Retirar los 5 GPTs de Silvestre **solo cuando él valide Lexis**.
