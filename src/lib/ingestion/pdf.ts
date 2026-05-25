// =====================================================
// Parser PDF client-side
// Usa pdfjs-dist (Mozilla PDF.js), funciona en browser.
// Evita dependencias Node.js incompatibles con Cloudflare Pages.
// =====================================================

'use client';

import type * as PdfjsLib from 'pdfjs-dist';

let pdfjsPromise: Promise<typeof PdfjsLib> | null = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((mod) => {
      // worker desde CDN de Mozilla
      mod.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.mjs';
      return mod;
    });
  }
  return pdfjsPromise;
}

export interface PdfParseResult {
  text: string;
  page_count: number;
  metadata: Record<string, unknown>;
}

export async function parsePdf(file: File): Promise<PdfParseResult> {
  const pdfjs = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;

  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items
      .map((it: any) => ('str' in it ? it.str : ''))
      .join(' ');
    pages.push(text);
  }

  const meta = await doc.getMetadata().catch(() => null);

  return {
    text: pages.join('\n\n').trim(),
    page_count: doc.numPages,
    metadata: (meta?.info as Record<string, unknown>) || {},
  };
}
