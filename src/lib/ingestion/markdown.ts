// =====================================================
// Parser Markdown
// =====================================================

'use client';

import matter from 'gray-matter';

export interface MarkdownParseResult {
  text: string;
  frontmatter: Record<string, unknown>;
}

// SEGURIDAD (auditoría 2026-09-08): gray-matter deja que el propio fichero elija
// el "motor" de frontmatter, y su motor `javascript` ejecuta el contenido con
// eval. Un .md de un tercero con cabecera `---javascript` correría código en la
// sesión autenticada. Forzamos YAML y desactivamos cualquier motor ejecutable:
// si un fichero pide js, el motor lanza y caemos al fallback de texto plano.
const SAFE_MATTER_OPTS = {
  language: 'yaml',
  engines: {
    javascript: () => {
      throw new Error('Frontmatter JavaScript deshabilitado por seguridad');
    },
    js: () => {
      throw new Error('Frontmatter JavaScript deshabilitado por seguridad');
    },
    coffee: () => {
      throw new Error('Frontmatter CoffeeScript deshabilitado por seguridad');
    },
  },
} as const;

export async function parseMarkdown(file: File): Promise<MarkdownParseResult> {
  const text = await file.text();
  try {
    const parsed = matter(text, SAFE_MATTER_OPTS as Parameters<typeof matter>[1]);
    return {
      text: parsed.content.trim(),
      frontmatter: parsed.data,
    };
  } catch {
    return { text: text.trim(), frontmatter: {} };
  }
}
