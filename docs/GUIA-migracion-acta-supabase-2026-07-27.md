# GUÍA — Aplicar la migración de Acta en el Supabase de Lexis · 2026-07-27

**Resultado final:** las 6 tablas `acta_*` + el bucket `acta-audio` existen en la BD
de Lexis; con eso el Worker de Acta puede apuntar a la BD única (consolidación).
**Tiempo estimado:** 3 min · **Necesitas:** sesión de Supabase con la cuenta
**javier.calero@porcelanosagrupo.com** (org Porcelanosa, la misma donde vive Lexis).

## Antes de empezar

Nada que buscar: el SQL ya está escrito en el repo de Lexis
(`supabase_migrations\20260723120000_acta_tables.sql`) y el Paso 1 te lo deja
en el portapapeles.

## Fase única — pegar el SQL (pasos 1-3)

### Paso 1 — Copia el SQL al portapapeles

En cualquier terminal (o pulsa Run aquí):

```powershell
Get-Content "C:\Users\ES00500148\Desktop\Proyectos IA\10-lexis-segundo-cerebro\supabase_migrations\20260723120000_acta_tables.sql" -Raw -Encoding UTF8 | Set-Clipboard
```

✅ Verás: nada (el comando no imprime). El SQL entero queda copiado.

### Paso 2 — Abre el SQL Editor del proyecto de Lexis

1. Entra en `https://supabase.com/dashboard` — con la cuenta **javier.calero@porcelanosagrupo.com**.
2. Asegúrate de que arriba está seleccionada la **organización de Porcelanosa** y abre el proyecto **Lexis** (`cvtbzxeizdaihyitbphh`) — el mismo donde vive tu segundo cerebro, NO el proyecto `acta`.
3. En el menú lateral izquierdo, pulsa el icono **«SQL Editor»**.
4. Pulsa **«New query»** (arriba a la izquierda del editor).

✅ Verás: un editor de SQL vacío.

### Paso 3 — Pega y ejecuta

1. Haz clic dentro del editor y pega (**Ctrl+V**).
2. Pulsa el botón verde **«Run»** (abajo a la derecha, o Ctrl+Enter).

✅ Verás: **«Success. No rows returned»**.
⚠️ Si ves un error de «policy … already exists» o similar: no pasa nada — la
migración es idempotente; vuelve a pulsar «Run» y debería terminar en Success.
Si el error es otro, copia el texto y pégamelo en el chat.

## Al terminar

Dime **«hecho»**. Entonces yo, desde aquí, sin que toques nada más:
1. Cambio los 5 secretos del Worker al proyecto de Lexis (leyendo los valores
   de tu `.env.local` local — nunca pasan por el chat).
2. Redespliego el Worker.
3. Verifico `/health`, el CORS y que las tablas responden.
4. Te aviso para la prueba final: grabar 1-2 min desde **lexis-jade.vercel.app/meetings** en el iPhone.
