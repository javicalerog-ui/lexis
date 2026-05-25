// =====================================================
// Adapter: RSS / Atom
//
// Pull-based. Polea un feed RSS/Atom y captura los items
// nuevos como memorias.
//
// State usado:
//   - last_seen_ids: ID(s) últimos vistos para dedup
//   - last_pub_date: para optimizar (skip items anteriores)
// =====================================================

import type { ConnectorAdapter, AdapterContext, AdapterRunResult, ConnectorItem } from '../types';

const MAX_ITEMS_PER_RUN = 30;

// Parser RSS/Atom muy simple sin dependencias.
// Funciona para los feeds más comunes; para feeds raros, futuro.
function parseFeed(xml: string): Array<{
  id: string;
  title: string;
  link: string;
  description: string;
  pub_date: string | null;
}> {
  const items: Array<any> = [];
  // RSS 2.0
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  // Atom
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;

  function extract(block: string, tag: string): string {
    const re = new RegExp(
      `<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
      'i'
    );
    const m = block.match(re);
    if (!m) return '';
    return m[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .trim();
  }

  function extractLink(block: string): string {
    // Atom: <link href="..." />
    const atom = block.match(/<link[^>]*href="([^"]+)"/i);
    if (atom) return atom[1];
    // RSS: <link>...</link>
    return extract(block, 'link');
  }

  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const guid = extract(block, 'guid') || extract(block, 'link');
    items.push({
      id: guid,
      title: extract(block, 'title'),
      link: extractLink(block),
      description: extract(block, 'description') || extract(block, 'content:encoded'),
      pub_date: extract(block, 'pubDate') || extract(block, 'dc:date') || null,
    });
  }

  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[1];
    items.push({
      id: extract(block, 'id'),
      title: extract(block, 'title'),
      link: extractLink(block),
      description: extract(block, 'summary') || extract(block, 'content'),
      pub_date: extract(block, 'published') || extract(block, 'updated') || null,
    });
  }

  return items;
}

export const rssAdapter: ConnectorAdapter = {
  type: 'rss',
  label: 'RSS / Atom',
  description:
    'Polea un feed RSS o Atom y captura los items nuevos como memorias. Útil para blogs, newsletters con feed, podcasts, releases de GitHub.',
  glyph: '⌁',
  oauth_provider: null,
  supports_schedule: true,
  supports_webhook: false,

  config_schema: [
    {
      key: 'feed_url',
      label: 'URL del feed',
      type: 'text',
      description: 'URL completa del feed RSS o Atom.',
      required: true,
      placeholder: 'https://example.com/feed.xml',
    },
    {
      key: 'include_description',
      label: 'Incluir descripción',
      type: 'boolean',
      description: 'Si true, captura título + descripción. Si false, solo título.',
      default: true,
    },
    {
      key: 'max_age_days',
      label: 'Edad máxima (días)',
      type: 'number',
      description: 'Ignorar items publicados hace más de N días al primer run.',
      default: 7,
    },
  ],

  validate_config(config) {
    const url = config.feed_url as string | undefined;
    if (!url) return { ok: false, error: 'feed_url es obligatorio' };
    try {
      new URL(url);
    } catch {
      return { ok: false, error: 'feed_url no es una URL válida' };
    }
    return { ok: true };
  },

  async run(ctx: AdapterContext): Promise<AdapterRunResult> {
    const url = ctx.config.feed_url as string;
    const includeDesc = (ctx.config.include_description as boolean) ?? true;
    const maxAgeDays = (ctx.config.max_age_days as number) ?? 7;

    const seenIds = new Set<string>(
      (ctx.state.seen_ids as string[]) ?? []
    );

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Lexis/1.0 (https://lexis.app)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    });

    if (!res.ok) {
      throw new Error(`Feed devolvió ${res.status}`);
    }

    const xml = await res.text();
    const parsed = parseFeed(xml);

    const ageCutoff = Date.now() - maxAgeDays * 86400_000;
    const items: ConnectorItem[] = [];

    for (const entry of parsed) {
      if (items.length >= MAX_ITEMS_PER_RUN) break;
      if (!entry.id) continue;
      if (seenIds.has(entry.id)) continue;

      // Filtro de edad
      if (entry.pub_date) {
        const pubMs = Date.parse(entry.pub_date);
        if (!Number.isNaN(pubMs) && pubMs < ageCutoff) continue;
      }

      const title = entry.title || '(sin título)';
      const desc = entry.description?.slice(0, 4000) || '';
      const content = includeDesc && desc ? `${title}\n\n${desc}` : title;

      items.push({
        external_id: `rss_${ctx.connector_id}_${entry.id}`,
        content,
        source_type: 'url',
        source_uri: entry.link || undefined,
        captured_at: entry.pub_date ? new Date(entry.pub_date).toISOString() : undefined,
        extra_metadata: {
          feed_url: url,
          rss_id: entry.id,
          rss_title: title,
        },
      });
    }

    // State: mantener solo los últimos 300 IDs vistos para dedup
    const newSeenIds = [
      ...items.map((i) => i.extra_metadata!.rss_id as string),
      ...Array.from(seenIds),
    ].slice(0, 300);

    return {
      items,
      new_state: {
        seen_ids: newSeenIds,
        last_run_at: new Date().toISOString(),
        feed_url: url,
      },
      debug: {
        total_parsed: parsed.length,
        already_seen: parsed.length - items.length,
      },
    };
  },
};
