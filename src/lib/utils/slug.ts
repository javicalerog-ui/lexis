// =====================================================
// Slug generator
// Convierte "Gaiata 1 — Brancal de la Ciutat" en
// "gaiata-1-brancal-de-la-ciutat"
// =====================================================

export function toSlug(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')         // quitar diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')           // sólo alfanum + espacios + guiones
    .trim()
    .replace(/[\s_-]+/g, '-')                // espacios/guiones múltiples → uno
    .replace(/^-+|-+$/g, '')                 // trim guiones
    .slice(0, 80);                           // límite razonable
}

export function uniqueSlug(base: string, taken: Set<string>): string {
  let slug = toSlug(base);
  if (!taken.has(slug)) return slug;
  let n = 2;
  while (taken.has(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}
