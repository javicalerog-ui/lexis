# GUÍA — Comprobaciones previas (Build 1) para la unificación de Lexis · 2026-09-08

**Resultado final:** sabremos 4 cosas del estado real de Supabase/red que ahora mismo no puedo ver desde el código, y que desbloquean el cargador de datos y el alta de Silvestre.
**Tiempo estimado:** 15-20 min · **Necesitas:** estar logueado en Supabase con **`javier.calero@porcelanosagrupo.com`** (org Porcelanosa) + una ventana de PowerShell en tu portátil.

## Qué vamos a averiguar
1. Si el registro de usuarios nuevos está abierto (hay que cerrarlo antes de meter a Silvestre).
2. Si el bucket de ficheros `lexis-raw` es público (fuga potencial entre usuarios).
3. Qué migraciones están aplicadas — sobre todo la de la **agenda de recordatorios**.
4. Si tu red corporativa deja conectar a Postgres directo (decide cómo cargará los datos el script).

Las nº 2 y 3 se resuelven con **una sola consulta SQL**. La nº 1 es por menús. La nº 4 es en PowerShell.

---

## Fase 1 — Diagnóstico por SQL (comprobaciones 2 y 3)

### Paso 1 — Entra en el proyecto correcto de Supabase
1. Ve a `https://supabase.com/dashboard/projects` con la cuenta **`javier.calero@porcelanosagrupo.com`**.
2. Entra en el proyecto cuyo ID es **`cvtbzxeizdaihyitbphh`** (compruébalo en la URL: `.../project/cvtbzxeizdaihyitbphh/...`).

✅ Verás: el dashboard del proyecto de Lexis.
⚠️ Si ves "clavis", "market-pulse" o "radar-personal": es la org equivocada (gmail). Cambia de organización arriba a la izquierda.

### Paso 2 — Abre el SQL Editor y ejecuta el diagnóstico
1. Menú lateral izquierdo → «**SQL Editor**» → «**New query**».
2. Pega esto completo y pulsa «**Run**»:

```sql
select 'bucket lexis-raw' as chequeo,
       coalesce((select case when b.public then 'PUBLICO (ojo)' else 'privado (ok)' end
                 from storage.buckets b where b.id = 'lexis-raw'), 'NO EXISTE') as resultado
union all
select 'events.notified_at (agenda recordatorios)',
       case when exists (select 1 from information_schema.columns
                         where table_schema='public' and table_name='events'
                           and column_name='notified_at')
            then 'existe (agenda lista)' else 'FALTA (hay que aplicarla)' end
union all
select 'tablas acta_* (grabador)',
       case when exists (select 1 from information_schema.tables
                         where table_schema='public' and table_name like 'acta_%')
            then 'existen' else 'faltan' end
union all
select 'push_subscriptions (nº filas)',
       (select count(*)::text from public.push_subscriptions) || ' suscripciones'
union all
select 'triggers P1 (fix 08-09)',
       (select count(*)::text from information_schema.triggers
        where trigger_name in ('memory_projects_same_owner','memory_entities_same_owner'))
       || ' filas (esperado 4)'
union all
select 'schema datos (Build 2)',
       case when exists (select 1 from information_schema.schemata where schema_name='datos')
            then 'ya aplicado' else 'aun no aplicado (normal por ahora)' end
order by chequeo;
```

✅ Verás: una tabla de 6 filas. **Hazme una captura y mándamela** — de ahí saco directamente qué hay que aplicar. Lo que espero: bucket "privado", `notified_at` "existe" (o "FALTA", que sería un pendiente rápido), triggers P1 "4 filas", schema datos "aun no aplicado".
⚠️ Si da error `relation "public.push_subscriptions" does not exist`: quita esa fila (las dos líneas del `union all` de push_subscriptions) y vuelve a ejecutar; me lo dices.

---

## Fase 2 — Registro de usuarios (comprobación 1, por menús)

### Paso 3 — Mira si el registro está abierto
1. En el menú lateral, entra en «**Authentication**».
2. Busca la sección de configuración de acceso: en la mayoría de versiones está en «**Sign In / Providers**» → proveedor «**Email**», o en «**Providers**». Ahí hay un interruptor con un texto tipo «**Allow new users to sign up**» / «**Enable sign-ups**».
3. Anota si está **activado (verde)** o **desactivado**.

✅ Verás: el interruptor con su estado.
⚠️ Si no encuentras ese texto exacto (el panel de Supabase cambia de sitio a menudo): hazme una captura de la pantalla de Authentication y lo localizo yo — **no cambies nada todavía**, solo mira.

> No toques el interruptor aún: primero confirmamos, y el cierre lo hacemos junto con el resto del blindaje del Build 1 para no dejar a medias.

---

## Fase 3 — Test de conectividad de red (comprobación 4, en PowerShell)

Esto decide si el script que carga los datos puede conectarse a Postgres directo desde tu portátil, o si tendrá que ir por HTTPS (o ejecutarse desde casa). No necesita ninguna contraseña.

### Paso 4 — ¿Llega el portátil a Postgres directo?
1. Abre **PowerShell** (tecla Windows, escribe "PowerShell", Enter).
2. Pega y ejecuta:

```powershell
Test-NetConnection db.cvtbzxeizdaihyitbphh.supabase.co -Port 5432
```

✅ Verás una línea `TcpTestSucceeded : True` o `False`. Dímela.
- **True** = tu red deja conectar a Postgres directo (lo más cómodo para el cargador).
- **False** = el firewall corporativo lo bloquea (lo esperable aquí); usaremos la vía HTTPS del Paso 5 o lo ejecutas desde casa.

### Paso 5 — ¿Llega por HTTPS a través del proxy? (la vía de respaldo)
1. En la misma PowerShell, pega y ejecuta:

```powershell
curl.exe -x http://172.22.1.121:8080 -s -o NUL -w "codigo=%{http_code}`n" https://cvtbzxeizdaihyitbphh.supabase.co/rest/v1/
```

✅ Verás una línea `codigo=XXX`. Dímela.
- `codigo=401` = **perfecto**, la API REST es alcanzable por el proxy (el 401 es normal, solo dice "falta la clave"); el cargador puede ir por aquí.
- `codigo=000` o se queda colgado = el proxy también lo bloquea; entonces el cargador se ejecuta desde tu red de casa/móvil.

---

## Al terminar

Mándame: (a) la captura de la tabla del Paso 2, (b) si el registro del Paso 3 está activado o no, (c) los dos resultados de los Pasos 4 y 5. Con eso cierro el diseño del cargador y te preparo el siguiente bloque (aplicar las migraciones del Build 2 + el alta de Silvestre). Si algo no cuadra, lo vemos sobre tu captura antes de tocar nada.
