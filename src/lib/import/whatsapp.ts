// =====================================================
// WhatsApp export parser (client-side)
// Parsea el formato de "exportar chat" sin archivos multimedia.
//
// Formatos típicos:
//   "12/05/2026, 18:34 - Javi: Hola"
//   "[12/05/2026, 18:34:12] Javi: Hola"
//   "12/05/26, 6:34 PM - Javi: Hola"
//
// Estrategia: detectar línea de mensaje vs continuación; agrupar
// mensajes consecutivos del mismo emisor en bloques temáticos.
// =====================================================

'use client';

export interface WhatsAppMessage {
  ts: string | null;        // ISO si se ha podido parsear
  raw_ts: string;           // string tal como aparece en el archivo
  sender: string;
  text: string;
}

export interface WhatsAppParseResult {
  chat_name: string;
  participants: string[];
  message_count: number;
  date_range: { from: string | null; to: string | null };
  // Agrupamos en bloques (~20-40 mensajes por bloque) para no generar miles de memorias
  blocks: Array<{
    title: string;
    text: string;
    from_ts: string | null;
    to_ts: string | null;
    participants: string[];
  }>;
}

const MESSAGES_PER_BLOCK = 30;

// Regex para detectar inicio de mensaje. Capturamos:
//   timestamp completo, emisor, texto
const LINE_REGEXES: RegExp[] = [
  // [12/05/2026, 18:34:12] Sender: text
  /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap]\.?[Mm]\.?)?)\]\s+([^:]+):\s(.*)$/,
  // 12/05/2026, 18:34 - Sender: text
  /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap]\.?[Mm]\.?)?)\s+-\s+([^:]+):\s(.*)$/,
];

function tryParseTimestamp(date: string, time: string): string | null {
  // dd/mm/yyyy o dd/mm/yy
  const m = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;

  // Time normalisation: 24h or am/pm
  let timeNorm = time.trim().toUpperCase();
  let ampm: 'AM' | 'PM' | null = null;
  if (timeNorm.endsWith('AM') || timeNorm.endsWith('A.M.')) {
    ampm = 'AM';
    timeNorm = timeNorm.replace(/A\.?M\.?$/, '').trim();
  } else if (timeNorm.endsWith('PM') || timeNorm.endsWith('P.M.')) {
    ampm = 'PM';
    timeNorm = timeNorm.replace(/P\.?M\.?$/, '').trim();
  }
  const parts = timeNorm.split(':').map((p) => parseInt(p));
  if (parts.length < 2 || parts.some(Number.isNaN)) return null;
  let [h, mi, s = 0] = parts;
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;

  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const date2 = new Date(iso);
  return isNaN(date2.getTime()) ? null : date2.toISOString();
}

function parseLine(line: string): { ts: string | null; raw_ts: string; sender: string; text: string } | null {
  for (const re of LINE_REGEXES) {
    const m = line.match(re);
    if (m) {
      const [, date, time, sender, text] = m;
      return {
        ts: tryParseTimestamp(date, time),
        raw_ts: `${date} ${time}`,
        sender: sender.trim(),
        text: text.trim(),
      };
    }
  }
  return null;
}

export async function parseWhatsApp(file: File): Promise<WhatsAppParseResult> {
  const raw = await file.text();
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  const messages: WhatsAppMessage[] = [];
  let current: WhatsAppMessage | null = null;

  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed) {
      if (current) messages.push(current);
      current = parsed;
    } else if (current && line.trim()) {
      // Continuación del mensaje anterior
      current.text += '\n' + line.trim();
    }
  }
  if (current) messages.push(current);

  // Filtrar mensajes-sistema típicos
  const filtered = messages.filter((m) => {
    const t = m.text.toLowerCase();
    return (
      !t.includes('cifrado de extremo a extremo') &&
      !t.includes('end-to-end encrypted') &&
      !t.startsWith('<multimedia omitido>') &&
      !t.startsWith('<media omitted>') &&
      m.text.length > 0
    );
  });

  const participants = Array.from(new Set(filtered.map((m) => m.sender)));
  const chat_name =
    file.name.replace(/\.(txt|log)$/i, '').replace(/whatsapp chat with /i, '') ||
    'WhatsApp Chat';

  // Bloques de N mensajes
  const blocks: WhatsAppParseResult['blocks'] = [];
  for (let i = 0; i < filtered.length; i += MESSAGES_PER_BLOCK) {
    const chunk = filtered.slice(i, i + MESSAGES_PER_BLOCK);
    const blockParticipants = Array.from(new Set(chunk.map((m) => m.sender)));
    const fromTs = chunk[0]?.ts ?? null;
    const toTs = chunk[chunk.length - 1]?.ts ?? null;

    const text = chunk
      .map((m) => `[${m.raw_ts}] ${m.sender}: ${m.text}`)
      .join('\n');

    const dateLabel =
      fromTs && toTs
        ? `${fromTs.slice(0, 10)}${
            fromTs.slice(0, 10) !== toTs.slice(0, 10)
              ? ` → ${toTs.slice(0, 10)}`
              : ''
          }`
        : 'fecha desconocida';

    blocks.push({
      title: `${chat_name} · ${dateLabel} (${chunk.length} mensajes)`,
      text,
      from_ts: fromTs,
      to_ts: toTs,
      participants: blockParticipants,
    });
  }

  const tss = filtered.map((m) => m.ts).filter(Boolean) as string[];

  return {
    chat_name,
    participants,
    message_count: filtered.length,
    date_range: {
      from: tss.length ? tss[0] : null,
      to: tss.length ? tss[tss.length - 1] : null,
    },
    blocks,
  };
}
