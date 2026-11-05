import assert from 'node:assert/strict';
import test from 'node:test';
import { motivoBorrado, RETENCION_DIAS, limpiarFotos } from '../src/lib/assistant/retencionFotos.ts';

const AHORA = Date.UTC(2027, 0, 1);
const haceDias = (d) => new Date(AHORA - d * 86_400_000).toISOString();
const haceHoras = (h) => new Date(AHORA - h * 3_600_000).toISOString();

test('una foto con memoria se conserva hasta los 90 dias', () => {
  assert.equal(RETENCION_DIAS, 90);
  assert.equal(motivoBorrado(haceDias(89), 'active', AHORA), null);
  assert.equal(motivoBorrado(haceDias(90), 'active', AHORA), 'caducada');
  assert.equal(motivoBorrado(haceDias(120), 'superseded', AHORA), 'caducada');
});

test('una huerfana espera 24 h: la memoria se guarda en segundo plano', () => {
  assert.equal(motivoBorrado(haceHoras(23), null, AHORA), null);
  assert.equal(motivoBorrado(haceHoras(25), null, AHORA), 'huerfana');
  assert.equal(motivoBorrado(haceHoras(25), 'deleted', AHORA), 'huerfana');
});

test('una fecha ilegible no borra nada', () => {
  assert.equal(motivoBorrado('no-es-fecha', null, AHORA), null);
});

function falsoSvc({ objetos, memorias, errorMemorias = null, errorBorrado = null }) {
  const borrados = [];
  const actualizadas = [];
  return {
    borrados,
    actualizadas,
    storage: {
      from: () => ({
        list: async () => ({ data: objetos, error: null }),
        remove: async (rutas) => {
          if (errorBorrado) return { data: null, error: errorBorrado };
          borrados.push(...rutas);
          return { data: [], error: null };
        },
      }),
    },
    from: () => ({
      select: () => {
        const q = {
          eq: () => q,
          in: async () => ({ data: errorMemorias ? null : memorias, error: errorMemorias }),
        };
        return q;
      },
      update: (cambios) => {
        const q = {
          eq: (col, val) => {
            if (col === 'id') actualizadas.push({ id: val, ...cambios });
            return q;
          },
          then: (ok) => ok({ error: null }),
        };
        return q;
      },
    }),
  };
}

const obj = (name, created_at) => ({ id: `id-${name}`, name, created_at });
const mem = (id, name, status) => ({
  id,
  status,
  source_metadata: { storage_path: `u1/asistente/${name}`, via: 'asistente-foto', caption_raw: { ocr_text: 'TOTAL 10' } },
});

test('borra caducadas y huerfanas, conserva las vigentes y el texto de la memoria', async () => {
  const svc = falsoSvc({
    objetos: [
      obj('vieja.jpg', haceDias(100)),
      obj('vigente.jpg', haceDias(10)),
      obj('sin-memoria.jpg', haceDias(2)),
      obj('recien.jpg', haceHoras(1)),
      obj('olvidada.jpg', haceDias(3)),
    ],
    memorias: [
      mem('m1', 'vieja.jpg', 'active'),
      mem('m2', 'vigente.jpg', 'active'),
      mem('m3', 'olvidada.jpg', 'deleted'),
    ],
  });
  const r = await limpiarFotos(svc, ['u1'], AHORA);
  assert.deepEqual(r, { revisadas: 5, caducadas: 1, huerfanas: 2, errores: 0 });
  assert.deepEqual(svc.borrados.sort(), [
    'u1/asistente/olvidada.jpg',
    'u1/asistente/sin-memoria.jpg',
    'u1/asistente/vieja.jpg',
  ]);
  const m1 = svc.actualizadas.find((a) => a.id === 'm1');
  assert.equal(m1.source_uri, null);
  assert.equal(m1.source_metadata.storage_path, null);
  assert.equal(m1.source_metadata.caption_raw.ocr_text, 'TOTAL 10');
  assert.equal(svc.actualizadas.some((a) => a.id === 'm2'), false);
});

test('si no se pueden leer las memorias no borra nada', async () => {
  const svc = falsoSvc({
    objetos: [obj('a.jpg', haceDias(100))],
    memorias: [],
    errorMemorias: { message: 'caida' },
  });
  const original = console.error;
  console.error = () => {};
  const r = await limpiarFotos(svc, ['u1'], AHORA);
  console.error = original;
  assert.equal(r.errores, 1);
  assert.deepEqual(svc.borrados, []);
});
