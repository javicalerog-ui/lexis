import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pareceCorreccion,
  correccionDe,
  textoCorreccion,
  conAvisoCifra,
} from '../src/lib/assistant/correcciones.ts';

test('deja pasar al LLM las formas habituales de corregir', () => {
  for (const t of [
    'No, eso no es correcto. Es Casa Montaña.',
    'Eso está mal, es de Alzira, no de ahí.',
    'Me he equivocado: el coche es un BMW',
    'me equivoqué, son las 12',
    'Son cinco, no cuatro',
    'Te equivocas',
    'En realidad se llama Pablo',
    'Corrige eso: mi primo mayor es Pablo',
    'Mi socia no se llama Ana, se llama María',
    'NO. Es el jueves',
  ]) {
    assert.equal(pareceCorreccion(t), true, t);
  }
});

test('las preguntas y los mensajes normales no pasan por el LLM', () => {
  for (const t of [
    '¿No era Casa Carmela?',
    'Eso está mal, ¿no?',
    '¿Cuánto vendimos en Francia en 2025?',
    'Apunta que mañana como con Bruno',
    'Recuérdame llamar a Pedro a las 12',
    'Hola',
    'Gracias',
    '',
  ]) {
    assert.equal(pareceCorreccion(t), false, t);
  }
});

const corr = {
  hecho: 'Ana García es originaria de Alzira.',
  para_el_usuario: 'Ana García es originaria de Alzira.',
  antes: 'Gandía',
  ahora: 'Alzira',
  tema: 'lugar de origen',
  sobre_cifras: false,
  dijo: 'Eso está mal, es de Alzira',
  conversacion: [{ role: 'assistant', content: 'Es de Gandía.' }],
};

test('el texto para la sintesis lleva la marca, lo anterior y la conversacion', () => {
  const t = textoCorreccion(corr);
  assert.ok(t.startsWith('CORRECCIÓN DEL USUARIO: Ana García es originaria de Alzira.'));
  assert.ok(t.includes('Antes constaba: Gandía'));
  assert.ok(t.includes('Eso está mal, es de Alzira'));
  assert.ok(t.includes('Asistente: Es de Gandía.'));
});

test('una cifra discutida no lleva la marca de dato bueno', () => {
  const t = textoCorreccion({ ...corr, sobre_cifras: true });
  assert.ok(t.startsWith('CIFRA DISCUTIDA POR EL USUARIO:'));
  assert.equal(t.includes('CORRECCIÓN DEL USUARIO'), false);
});

test('una correccion ya sustituida se marca como antigua', () => {
  const t = textoCorreccion(corr, true);
  assert.ok(t.startsWith('CORRECCIÓN ANTIGUA:'));
  assert.ok(t.includes('Antes constaba: Gandía'));
});

test('solo reconoce metadatos con una correccion valida', () => {
  assert.equal(correccionDe(null), null);
  assert.equal(correccionDe({ via: 'asistente' }), null);
  assert.equal(correccionDe({ correccion: corr }), corr);
});

test('el aviso de cifra va antes del detalle y no toca la cifra', () => {
  const c = { ...corr, dijo: 'No, fueron 40 millones', sobre_cifras: true };
  const con = conAvisoCifra('Francia: 36,65 M€.\n\n---detalle---\n- Filial: 36,38 M€', c, '5 de noviembre');
  assert.ok(con.startsWith('Francia: 36,65 M€.'));
  assert.ok(con.indexOf('Ojo: el 5 de noviembre') < con.indexOf('---detalle---'));
  assert.ok(con.includes('- Filial: 36,38 M€'));
  const sin = conAvisoCifra('Francia: 36,65 M€.', c, '5 de noviembre');
  assert.ok(sin.endsWith('la cifra oficial de los datos cargados.'));
});
