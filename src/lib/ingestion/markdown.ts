// =====================================================
// Parser Markdown
// =====================================================

'use client';

import matter from 'gray-matter';

export interface MarkdownParseResult {
  text: string;
  frontmatter: Record<string, unknown>;
}

export async function parseMarkdown(file: File): Promise<MarkdownParseResult> {
  const text = await file.text();
  try {
    const parsed = matter(text);
    return {
      text: parsed.content.trim(),
      frontmatter: parsed.data,
    };
  } catch {
    return { text: text.trim(), frontmatter: {} };
  }
}
