#!/usr/bin/env node
/**
 * scripts/generate-icons.mjs
 *
 * Convierte /public/icon.svg en los PNGs requeridos por:
 *   - PWA manifest (192, 512, maskable 512)
 *   - Apple touch icon (180)
 *   - Favicon (32, 16)
 *
 * Uso:
 *   npm run icons
 *
 * Requiere: sharp (devDependency).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SVG_PATH = path.join(ROOT, 'public', 'icon.svg');
const ICONS_DIR = path.join(ROOT, 'public', 'icons');

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error(
    '\n❌ Falta la dependencia "sharp".\n' +
      '   Instálala con:  npm install --save-dev sharp\n'
  );
  process.exit(1);
}

const TARGETS = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  // Apple touch icon (iOS)
  { name: 'apple-touch-icon.png', size: 180 },
  // Favicons
  { name: 'favicon-32.png', size: 32 },
  { name: 'favicon-16.png', size: 16 },
];

// Maskable: misma imagen pero con safe area garantizada (el SVG ya
// está diseñado para que el contenido quede dentro del círculo seguro).
const MASKABLE_TARGETS = [{ name: 'icon-maskable-512.png', size: 512 }];

async function main() {
  await fs.mkdir(ICONS_DIR, { recursive: true });
  const svg = await fs.readFile(SVG_PATH);

  for (const t of [...TARGETS, ...MASKABLE_TARGETS]) {
    const out = path.join(ICONS_DIR, t.name);
    await sharp(svg).resize(t.size, t.size).png().toFile(out);
    console.log(`✓ ${t.name} (${t.size}×${t.size})`);
  }

  console.log(`\nIconos generados en: ${path.relative(ROOT, ICONS_DIR)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
