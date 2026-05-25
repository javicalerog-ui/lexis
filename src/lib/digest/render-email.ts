// =====================================================
// Email renderer: convierte un GeneratedDigest en HTML
// listo para enviar. Estilos inline para compatibilidad.
// =====================================================

import type { GeneratedDigest } from './generate';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://lexis.app';

interface RenderOptions {
  digestId: string;
  appUrl?: string;
}

const COL = {
  bg: '#06080d',
  surface: '#0e1424',
  surfaceAlt: '#141b2e',
  line: 'rgba(120,145,220,0.14)',
  lineStrong: 'rgba(120,145,220,0.28)',
  fg0: '#e7ebf5',
  fg1: '#c8cfe1',
  fg2: '#8a93b8',
  fg3: '#5e6786',
  accent: '#4f8eff',
  accentBright: '#7ba8ff',
  violet: '#b347ff',
  violetBright: '#cc7bff',
  success: '#34d399',
  warning: '#fbbf24',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
  });
}

function periodLabel(start: string, end: string, cadence: string): string {
  const cadenceLabel =
    cadence === 'weekly' ? 'Semana' : cadence === 'biweekly' ? 'Quincena' : 'Mes';
  return `${cadenceLabel} ${fmtDate(start)} → ${fmtDate(end)}`;
}

export function renderDigestEmail(
  digest: GeneratedDigest,
  options: RenderOptions
): { subject: string; html: string; text: string } {
  const { payload, metrics, period_start, period_end } = digest;
  const appUrl = options.appUrl || APP_URL;
  const cadence = digest.period_end > digest.period_start ? 'weekly' : 'weekly';

  const subject = `Lexis · ${payload.headline.slice(0, 60)}`;

  // Plain-text fallback
  const text = [
    `LEXIS · ${periodLabel(period_start, period_end, cadence)}`,
    '',
    payload.headline.toUpperCase(),
    '',
    payload.overview,
    '',
    payload.what_moved.length ? 'LO QUE SE MOVIÓ' : null,
    ...payload.what_moved.map((m) => `· ${m.title}\n  ${m.detail}`),
    '',
    payload.decisions.length ? 'DECISIONES' : null,
    ...payload.decisions.map((d) => `· ${d.title}\n  ${d.detail}`),
    '',
    payload.stalled.length ? 'HILOS PARADOS' : null,
    ...payload.stalled.map(
      (s) => `· ${s.title} (${s.days_idle}d) — ${s.suggestion}`
    ),
    '',
    payload.people.length ? 'PERSONAS DEL PERIODO' : null,
    ...payload.people.map((p) => `· ${p.name}: ${p.context}`),
    '',
    payload.open_question ? `→ ${payload.open_question}` : null,
    '',
    `Ver en Lexis: ${appUrl}/digest/${options.digestId}`,
  ]
    .filter(Boolean)
    .join('\n');

  // Helpers para HTML inline
  const td = (style: string, content: string) =>
    `<td style="${style}">${content}</td>`;

  // ---------- HTML ----------

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${COL.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${COL.fg1};">
<center style="width:100%;background:${COL.bg};padding:32px 16px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:620px;margin:0 auto;">

  <!-- Header brand -->
  <tr>
    <td style="padding:0 0 24px 0;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          ${td(
            `padding:0;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:500;letter-spacing:0.06em;color:${COL.fg0};`,
            `<span style="background:linear-gradient(135deg,${COL.accent},${COL.violet});-webkit-background-clip:text;background-clip:text;color:transparent;">lexis</span>`
          )}
          ${td(
            `padding:0;text-align:right;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${COL.fg3};`,
            periodLabel(period_start, period_end, cadence)
          )}
        </tr>
      </table>
    </td>
  </tr>

  <!-- Headline card -->
  <tr>
    <td style="padding:0;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${COL.surface};border:1px solid ${COL.line};border-radius:16px;overflow:hidden;">
        <tr>
          <td style="padding:32px 28px;background:linear-gradient(135deg,${COL.surface} 0%,${COL.surfaceAlt} 100%);">
            <p style="margin:0 0 12px 0;font-size:10.5px;letter-spacing:0.18em;text-transform:uppercase;color:${COL.accentBright};font-weight:600;">Síntesis del periodo</p>
            <h1 style="margin:0 0 16px 0;font-family:Georgia,serif;font-size:24px;font-weight:500;line-height:1.3;color:${COL.fg0};letter-spacing:-0.01em;">${escapeHtml(payload.headline)}</h1>
            <p style="margin:0;font-size:15px;line-height:1.6;color:${COL.fg1};">${escapeHtml(payload.overview)}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Metrics strip -->
  <tr>
    <td style="padding:20px 0 0 0;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          ${metricCell('Memorias', metrics.new_memories)}
          ${metricCell('Proyectos tocados', metrics.projects_touched)}
          ${metricCell('Decisiones', metrics.decisions_count)}
          ${metricCell('Nuevas entidades', metrics.new_entities)}
        </tr>
      </table>
    </td>
  </tr>

  ${
    payload.what_moved.length
      ? section('Lo que se movió', COL.accent, payload.what_moved.map(
          (m) => `
        <p style="margin:0 0 6px 0;font-size:14.5px;font-weight:500;color:${COL.fg0};">${escapeHtml(m.title)}</p>
        <p style="margin:0;font-size:13.5px;line-height:1.55;color:${COL.fg1};">${escapeHtml(m.detail)}${
            m.project_slug
              ? ` <a href="${appUrl}/projects/${encodeURIComponent(m.project_slug)}" style="color:${COL.accentBright};text-decoration:none;border-bottom:1px solid ${COL.line};">ver proyecto →</a>`
              : ''
          }</p>
      `
        ))
      : ''
  }

  ${
    payload.decisions.length
      ? section('Decisiones tomadas', COL.success, payload.decisions.map(
          (d) => `
        <p style="margin:0 0 6px 0;font-size:14.5px;font-weight:500;color:${COL.fg0};">${escapeHtml(d.title)}</p>
        <p style="margin:0;font-size:13.5px;line-height:1.55;color:${COL.fg1};">${escapeHtml(d.detail)}</p>
      `
        ))
      : ''
  }

  ${
    payload.stalled.length
      ? section('Hilos parados', COL.warning, payload.stalled.map(
          (s) => `
        <p style="margin:0 0 4px 0;font-size:14.5px;font-weight:500;color:${COL.fg0};">${escapeHtml(s.title)} <span style="font-size:11px;font-weight:400;color:${COL.fg3};font-family:monospace;letter-spacing:0.04em;">· ${s.days_idle}d parado</span></p>
        <p style="margin:0;font-size:13.5px;line-height:1.55;color:${COL.fg2};font-style:italic;">${escapeHtml(s.suggestion)}</p>
      `
        ))
      : ''
  }

  ${
    payload.people.length
      ? section('Personas centrales', COL.violet, payload.people.map(
          (p) => `
        <p style="margin:0 0 4px 0;font-size:14.5px;font-weight:500;color:${COL.fg0};">${escapeHtml(p.name)}</p>
        <p style="margin:0;font-size:13.5px;line-height:1.55;color:${COL.fg1};">${escapeHtml(p.context)}</p>
      `
        ))
      : ''
  }

  ${
    payload.open_question
      ? `
  <tr>
    <td style="padding:28px 0 0 0;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:linear-gradient(135deg,rgba(179,71,255,0.06),rgba(79,142,255,0.04));border:1px solid ${COL.lineStrong};border-radius:12px;">
        <tr>
          <td style="padding:24px 24px;">
            <p style="margin:0 0 8px 0;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:${COL.violetBright};font-weight:600;">Una pregunta</p>
            <p style="margin:0;font-family:Georgia,serif;font-size:18px;line-height:1.5;color:${COL.fg0};font-style:italic;">${escapeHtml(payload.open_question)}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  `
      : ''
  }

  <!-- Tone note -->
  <tr>
    <td style="padding:24px 0 0 0;">
      <p style="margin:0;font-size:12px;color:${COL.fg3};text-align:center;font-style:italic;letter-spacing:0.02em;">${escapeHtml(payload.tone_note)}</p>
    </td>
  </tr>

  <!-- CTA -->
  <tr>
    <td style="padding:32px 0 0 0;text-align:center;">
      <a href="${appUrl}/digest/${options.digestId}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,${COL.accent},${COL.violet});color:#fff;text-decoration:none;border-radius:999px;font-size:13px;font-weight:500;letter-spacing:0.04em;">Ver completo en Lexis</a>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:40px 0 0 0;text-align:center;">
      <p style="margin:0;font-size:10.5px;letter-spacing:0.14em;text-transform:uppercase;color:${COL.fg3};">
        Lexis · tu segundo cerebro · <a href="${appUrl}" style="color:${COL.fg3};text-decoration:none;border-bottom:1px solid ${COL.line};">${appUrl.replace(/^https?:\/\//, '')}</a>
      </p>
    </td>
  </tr>

</table>
</center>
</body>
</html>`;

  return { subject, html, text };
}

function metricCell(label: string, value: number): string {
  return `
  <td style="padding:0 4px 0 0;" width="25%">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${COL.surface};border:1px solid ${COL.line};border-radius:12px;">
      <tr>
        <td style="padding:16px 12px;text-align:center;">
          <p style="margin:0;font-family:Georgia,serif;font-size:28px;font-weight:500;color:${COL.fg0};line-height:1;">${value}</p>
          <p style="margin:6px 0 0 0;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:${COL.fg3};">${label}</p>
        </td>
      </tr>
    </table>
  </td>`;
}

function section(title: string, dotColor: string, items: string[]): string {
  return `
  <tr>
    <td style="padding:32px 0 0 0;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td style="padding:0 0 14px 0;border-bottom:1px solid ${COL.line};">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="padding:0 8px 0 0;vertical-align:middle;"><span style="display:inline-block;width:6px;height:6px;border-radius:999px;background:${dotColor};box-shadow:0 0 8px ${dotColor};"></span></td>
                <td style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${COL.fg2};font-weight:500;">${title}</td>
              </tr>
            </table>
          </td>
        </tr>
        ${items
          .map(
            (content) => `
        <tr>
          <td style="padding:18px 0 0 0;">
            ${content}
          </td>
        </tr>`
          )
          .join('')}
      </table>
    </td>
  </tr>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
