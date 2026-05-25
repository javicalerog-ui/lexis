// =====================================================
// Parser XLSX client-side
// SheetJS funciona en browser.
// Genera una narrativa estructurada por hoja para
// embebido semántico (más útil que el raw tabular).
// =====================================================

'use client';

import * as XLSX from 'xlsx';

export interface XlsxParseResult {
  narrative: string;             // texto preparado para embed
  sheet_count: number;
  metadata: {
    sheets: Array<{ name: string; rows: number; cols: number; columns: string[] }>;
  };
}

export async function parseXlsx(file: File): Promise<XlsxParseResult> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });

  const sheets: XlsxParseResult['metadata']['sheets'] = [];
  const parts: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
    });

    if (!json.length) {
      sheets.push({ name: sheetName, rows: 0, cols: 0, columns: [] });
      parts.push(`## Hoja "${sheetName}"\nHoja vacía.`);
      continue;
    }

    const columns = Object.keys(json[0]);
    sheets.push({
      name: sheetName,
      rows: json.length,
      cols: columns.length,
      columns,
    });

    // Narrativa: cabecera + muestra (primeras 20 filas) + resumen estadístico
    const sample = json.slice(0, 20);
    const sampleLines = sample
      .map((row) =>
        columns.map((c) => `${c}: ${formatCell(row[c])}`).join(' | ')
      )
      .join('\n');

    parts.push(
      `## Hoja "${sheetName}"\n` +
        `Filas: ${json.length} | Columnas: ${columns.length}\n` +
        `Columnas: ${columns.join(', ')}\n\n` +
        `Muestra (primeras ${sample.length} filas):\n${sampleLines}`
    );
  }

  return {
    narrative: parts.join('\n\n---\n\n'),
    sheet_count: wb.SheetNames.length,
    metadata: { sheets },
  };
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.slice(0, 80);
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
