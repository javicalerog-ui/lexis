# Lexis heartbeat (Cloudflare Worker)

Late fiable que dispara los crons de Lexis **cada 5 minutos**. Sustituye al
workflow de GitHub Actions (`.github/workflows/reminders-cron.yml`), que GitHub
estrangula a "cada varias horas" en repos poco activos — por eso los
recordatorios llegaban tarde o se perdían (diagnóstico 2026-09-23).

Pinga los dos endpoints que entregan notificaciones:
- `GET /api/cron/reminders` → `reminder`/`deadline` + `follow_up` con hora.
- `GET /api/cron/proactive` → follow-ups del día, revisión semanal HPE, recarga mensual, reuniones.

Ambos van protegidos con `Authorization: Bearer <LEXIS_CRON_SECRET>`, que debe
ser **igual** al `CRON_SECRET` de Vercel.

## Despliegue (una sola vez)

> Proxy corporativo: pon `HTTPS_PROXY` delante de los comandos de red.

```powershell
cd "C:\Users\ES00500148\Desktop\Proyectos IA\10-lexis-segundo-cerebro\heartbeat-worker"
$env:HTTPS_PROXY='http://172.22.1.121:8080'; $env:HTTP_PROXY='http://172.22.1.121:8080'
```

1. **Login en Cloudflare** (si no lo estás ya):
   ```powershell
   npx wrangler login
   ```
2. **Guardar el secreto** (te pedirá el valor: pega el MISMO que `CRON_SECRET`
   de `.env.local` — nunca lo escribas en un chat):
   ```powershell
   npx wrangler secret put LEXIS_CRON_SECRET
   ```
3. **Desplegar**:
   ```powershell
   npx wrangler deploy
   ```
   La salida confirma el cron `*/5 * * * *` y da la URL `https://lexis-heartbeat.<subdominio>.workers.dev`.

## Comprobar que funciona

- **Manual (inmediato):** abre la URL `…workers.dev` en el navegador o:
  ```powershell
  curl https://lexis-heartbeat.<subdominio>.workers.dev/
  ```
  Debe devolver `status: 200` para los dos endpoints.
- **Programado:** en el panel de Cloudflare → Workers → lexis-heartbeat →
  Logs / Cron Triggers, o `npx wrangler tail`, ves un disparo cada 5 min.

## Después (opcional)

Cuando confirmes que el Worker dispara bien, puedes **desactivar el workflow de
GitHub** para no duplicar (aunque duplicar es inofensivo: `notified_at` evita
doble aviso y el proactivo tiene anti-spam). Para desactivarlo: GitHub → repo
`javicalerog-ui/lexis` → Actions → "Lexis reminders cron" → `···` → Disable workflow.
