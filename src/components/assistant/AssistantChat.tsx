'use client';

// =====================================================
// Chat del modo Silvestre: una sola pantalla, sin pestañas.
// Una caja de texto para todo — el backend decide si es una pregunta de datos
// de negocio, de su memoria, una foto o algo que apuntar.
//
// Pantalla de directivo en el móvil (propuesta Silvestre, 2026-10-20):
//   - Se comporta como una app: cabecera y barra fijas, alto = el visible con
//     teclado (visualViewport), márgenes seguros del iPhone, objetivos ≥44 px.
//   - Al llegar una respuesta se ve su PRINCIPIO, no el final.
//   - La caja de texto nunca se bloquea; mensajes de espera por fases y, si
//     algo falla, una frase llana + «Reintentar» (nunca un error técnico).
//   - La conversación sobrevive a cerrar la app (localStorage, sin fotos).
//   - Respuesta corta y el detalle plegado («Ver detalle»); fuentes en
//     lenguaje llano («Me lo contaste el 3 de octubre»).
//   - Botón «Foto»: la foto se reduce en el propio teléfono antes de enviarla.
// =====================================================

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { ActivarAvisos } from './ActivarAvisos';

export interface Ejemplo {
  texto: string;
  /** Si existe, el chip escribe esto en la caja (para completarlo) en vez de enviarlo. */
  completar?: string;
}

interface Fuente {
  etiqueta: string;
  texto: string;
  tipo: string;
}

type CodigoError = 'busy' | 'timeout' | 'session' | 'internal' | 'offline' | 'red' | 'interrumpido' | 'sin-foto';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  kind?: string;
  fuentes?: Fuente[];
  /** Mensaje de error con su pregunta para «Reintentar». */
  error?: {
    code: CodigoError;
    pregunta: string;
    reintento: boolean;
    fotoDe?: string;
    /** «busy»: se reintenta solo una vez, pasado medio minuto. */
    auto?: boolean;
  };
  /** Mensaje del usuario con foto (la imagen en sí no se guarda). */
  conFoto?: boolean;
  /** Respuesta a una foto: su texto, para poder seguir preguntando. */
  foto?: { descripcion: string; ocr_text: string };
  /** La foto traía una fecha: se ofrece el aviso (Sí/No). */
  evento?: { titulo: string; cuando: string; respondido?: boolean } | null;
}

const MENSAJE_ERROR: Record<CodigoError, string> = {
  busy: 'Ahora mismo el servicio está saturado. Prueba otra vez en un minuto.',
  timeout: 'He tardado demasiado y he parado para no tenerte esperando.',
  session: 'Tienes que volver a entrar en Lexis.',
  internal: 'Algo ha fallado por mi parte.',
  offline: 'No hay conexión a internet. Revisa la cobertura o el wifi.',
  red: 'Se ha cortado la conexión.',
  interrumpido: 'No llegué a responder.',
  'sin-foto': 'No llegué a responder a la foto. Vuelve a enviarla, por favor.',
};

const PLAZO_CLIENTE_MS = 55_000;
const MAX_GUARDADOS = 40;
const nuevoId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---------- Render de texto ----------------------------------------------

function negritas(linea: string) {
  return linea.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4 ? (
      <strong key={j}>{p.slice(2, -2)}</strong>
    ) : (
      <span key={j}>{p}</span>
    )
  );
}

const esFilaTabla = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const esSeparador = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
const celdas = (l: string) =>
  l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

// Markdown ligero y seguro: negritas, listas con «- » y TABLAS convertidas en
// lista (en un móvil una tabla ancha obliga a desplazar en horizontal).
function Formateado({ texto }: { texto: string }) {
  const lineas = texto
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\((?:https?:)?[^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .split('\n');
  const bloques: React.ReactNode[] = [];
  let i = 0;
  while (i < lineas.length) {
    if (esFilaTabla(lineas[i])) {
      const filas: string[][] = [];
      while (i < lineas.length && esFilaTabla(lineas[i])) {
        if (!esSeparador(lineas[i])) filas.push(celdas(lineas[i]));
        i++;
      }
      const [cab, ...cuerpo] = filas;
      if (cab && cuerpo.length) {
        bloques.push(
          <ul key={`t${i}`} style={{ margin: '6px 0', paddingLeft: 20 }}>
            {cuerpo.map((fila, k) => (
              <li key={k} style={{ margin: '4px 0' }}>
                <strong>{fila[0]}</strong>
                {fila.slice(1).map((c, j) => (
                  <span key={j}>
                    {j === 0 ? ' — ' : ' · '}
                    {cab[j + 1] ? `${cab[j + 1]}: ` : ''}
                    {negritas(c)}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        );
      }
      continue;
    }
    const linea = lineas[i];
    const item = /^\s*[-*•]\s+(.*)$/.exec(linea);
    if (item) {
      const items: string[] = [];
      while (i < lineas.length) {
        const m = /^\s*[-*•]\s+(.*)$/.exec(lineas[i]);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      bloques.push(
        <ul key={`u${i}`} style={{ margin: '6px 0', paddingLeft: 20 }}>
          {items.map((t, k) => (
            <li key={k} style={{ margin: '4px 0' }}>
              {negritas(t)}
            </li>
          ))}
        </ul>
      );
      continue;
    }
    bloques.push(
      <div key={`l${i}`} style={{ minHeight: linea.trim() ? undefined : 10 }}>
        {negritas(linea)}
      </div>
    );
    i++;
  }
  return <>{bloques}</>;
}

function Respuesta({ texto }: { texto: string }) {
  const [principal, ...resto] = texto.split(/\n?\s*-{3}\s*detalle\s*-{3}\s*\n?/i);
  const detalle = resto.join('\n').trim();
  return (
    <>
      <Formateado texto={principal.trim()} />
      {detalle && (
        <details style={{ marginTop: 10 }}>
          <summary style={estiloDesplegable}>Ver detalle</summary>
          <div style={{ marginTop: 8 }}>
            <Formateado texto={detalle} />
          </div>
        </details>
      )}
    </>
  );
}

function Fuentes({ fuentes }: { fuentes: Fuente[] }) {
  if (!fuentes.length) return null;
  return (
    <details style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
      <summary style={{ ...estiloDesplegable, color: 'var(--fg-2)', fontSize: 15.5 }}>
        De dónde lo saco
      </summary>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {fuentes.map((f, k) => (
          <div
            key={k}
            style={{
              fontSize: 15.5,
              lineHeight: 1.45,
              background: 'var(--bg-1)',
              border: '1px solid var(--line)',
              borderRadius: 10,
              padding: '8px 10px',
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{f.etiqueta}</div>
            {f.texto && (
              <div style={{ color: 'var(--fg-1)', marginTop: 2 }}>
                {f.texto.length > 280 ? f.texto.slice(0, 280) + '…' : f.texto}
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

// ---------- Foto: reducir en el teléfono ---------------------------------

async function cargarImagen(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function reducirFoto(file: File): Promise<{ b64: string; url: string }> {
  const img = await cargarImagen(file);
  for (const [lado, calidad] of [
    [2048, 0.82],
    [1600, 0.72],
    [1200, 0.65],
  ] as const) {
    const escala = Math.min(1, lado / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', calidad));
    if (!blob) continue;
    const dataUrl: string = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
    const b64 = dataUrl.split(',')[1] || '';
    if (b64.length <= 3_000_000) return { b64, url: URL.createObjectURL(blob) };
  }
  throw new Error('foto demasiado grande');
}

// ---------- Componente ---------------------------------------------------

export function AssistantChat({
  userId,
  nombre,
  ejemplos,
  aviso,
}: {
  userId: string;
  nombre: string | null;
  ejemplos: Ejemplo[];
  aviso: { id: string; titulo: string; cuando: string } | null;
}) {
  const clave = `lexis:chat:v2:${userId}`;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [cargado, setCargado] = useState(false);
  const [input, setInput] = useState('');
  const [pendiente, setPendiente] = useState<{ inicio: number; conFoto: boolean } | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [online, setOnline] = useState(true);
  const [foto, setFoto] = useState<{ b64: string; url: string } | null>(null);
  const [fotoError, setFotoError] = useState<string | null>(null);
  const [vista, setVista] = useState<{ alto: number; arriba: number } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const objetivo = useRef<{ id: string; modo: 'inicio' | 'final' } | null>(null);
  // Fotos de esta sesión (para «Reintentar» y miniaturas); no se guardan.
  const fotos = useRef<Map<string, { b64: string; url: string }>>(new Map());
  // Estado vivo para callbacks diferidos (reintento automático).
  const messagesRef = useRef<Msg[]>([]);
  const pendienteRef = useRef(false);
  messagesRef.current = messages;
  pendienteRef.current = !!pendiente;

  // --- Conversación guardada (L-12) ---
  useEffect(() => {
    let previos: Msg[] = [];
    try {
      const raw = localStorage.getItem(clave);
      if (raw) previos = JSON.parse(raw) as Msg[];
    } catch {
      previos = [];
    }
    if (!Array.isArray(previos)) previos = [];
    // Se cerró la app esperando respuesta: lo decimos y se puede reintentar.
    const ultimo = previos[previos.length - 1];
    if (ultimo && ultimo.role === 'user') {
      previos.push({
        id: nuevoId(),
        role: 'assistant',
        content: '',
        error: {
          code: ultimo.conFoto ? 'sin-foto' : 'interrumpido',
          pregunta: ultimo.content,
          reintento: true,
        },
      });
    }
    if (aviso && !previos.some((m) => m.id === `aviso-${aviso.id}`)) {
      previos.push({
        id: `aviso-${aviso.id}`,
        role: 'assistant',
        kind: 'aviso',
        content: `🔔 **Aviso:** ${aviso.titulo}\n${aviso.cuando.charAt(0).toUpperCase()}${aviso.cuando.slice(1)}`,
      });
      objetivo.current = { id: `aviso-${aviso.id}`, modo: 'inicio' };
    } else if (previos.length) {
      objetivo.current = { id: previos[previos.length - 1].id, modo: 'final' };
    }
    if (aviso) {
      try {
        window.history.replaceState(null, '', '/asistente');
      } catch {
        // sin History API: no pasa nada
      }
    }
    setMessages(previos);
    setCargado(true);
  }, [clave, aviso]);

  useEffect(() => {
    if (!cargado) return;
    try {
      const guardables = messages.slice(-MAX_GUARDADOS);
      localStorage.setItem(clave, JSON.stringify(guardables));
    } catch {
      // almacenamiento lleno o bloqueado: la conversación vive solo en pantalla
    }
  }, [messages, cargado, clave]);

  // --- Alto real con teclado (L-08) ---
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const ajustar = () => setVista({ alto: vv.height, arriba: vv.offsetTop });
    ajustar();
    vv.addEventListener('resize', ajustar);
    vv.addEventListener('scroll', ajustar);
    return () => {
      vv.removeEventListener('resize', ajustar);
      vv.removeEventListener('scroll', ajustar);
    };
  }, []);

  // --- Conexión ---
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // --- Contador de espera (fases L-06) ---
  useEffect(() => {
    if (!pendiente) return;
    setSegundos(0);
    const t = setInterval(() => setSegundos(Math.floor((Date.now() - pendiente.inicio) / 1000)), 1000);
    return () => clearInterval(t);
  }, [pendiente]);

  // --- Desplazamiento: al principio de cada respuesta nueva ---
  useLayoutEffect(() => {
    const o = objetivo.current;
    const cont = scrollRef.current;
    if (!o || !cont) return;
    const el = cont.querySelector<HTMLElement>(`[data-id="${o.id}"]`);
    if (!el) return;
    objetivo.current = null;
    if (o.modo === 'inicio') {
      cont.scrollTo({ top: Math.max(0, el.offsetTop - 12), behavior: 'smooth' });
    } else {
      cont.scrollTo({ top: cont.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    if (pendiente) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [pendiente]);

  // --- Caja de texto que crece ---
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [input]);

  const anadir = useCallback((m: Msg, modo: 'inicio' | 'final') => {
    objetivo.current = { id: m.id, modo };
    setMessages((prev) => [...prev, m]);
  }, []);

  async function preguntar(
    pregunta: string,
    opts: {
      imagen?: { b64: string; url: string };
      /** Clave de la foto en `fotos` (para volver a reintentarla). */
      fotoKey?: string;
      reintento?: boolean;
      quitarErrorId?: string;
      /** Es el reintento automático tras «busy» (no se repite otra vez). */
      auto?: boolean;
    } = {}
  ) {
    if (pendienteRef.current) return;
    const texto = pregunta.trim();
    if (!texto && !opts.imagen) return;

    let base = messagesRef.current;
    if (opts.quitarErrorId) base = base.filter((m) => m.id !== opts.quitarErrorId);

    const userMsgId = nuevoId();
    const fotoKey = opts.fotoKey ?? (opts.imagen ? userMsgId : undefined);
    if (!opts.reintento) {
      if (opts.imagen) fotos.current.set(userMsgId, opts.imagen);
      const um: Msg = { id: userMsgId, role: 'user', content: texto, conFoto: !!opts.imagen };
      base = [...base, um];
      objetivo.current = { id: userMsgId, modo: 'final' };
    }
    setMessages(base);
    setPendiente({ inicio: Date.now(), conFoto: !!opts.imagen });

    // Contexto: últimos turnos válidos; y el texto de la última foto si es reciente.
    const validos = base.filter((m) => !m.error && m.kind !== 'aviso');
    // (el último válido es la propia pregunta: va aparte)
    const historial = validos
      .slice(-9, -1)
      .map((m) => ({
        role: m.role,
        content: (m.conFoto ? '[Foto] ' : '') + m.content,
      }));
    const ultimaFoto = [...validos].slice(-4).reverse().find((m) => m.foto)?.foto;

    const ctrl = new AbortController();
    const temporizador = setTimeout(() => ctrl.abort(), PLAZO_CLIENTE_MS);
    let error: CodigoError | null = null;
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pregunta: texto,
          historial,
          // Con foto nunca: si falló, la foto aún no se archivó.
          reintento: !!opts.reintento && !opts.imagen,
          imagen: opts.imagen?.b64,
          contextoFoto: !opts.imagen && ultimaFoto ? ultimaFoto : undefined,
        }),
        signal: ctrl.signal,
      });
      let data: Record<string, unknown> = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      if (res.status === 401) error = 'session';
      else if (!res.ok || data.code !== 'ok' || typeof data.answer !== 'string') {
        const c = String(data.code || '');
        error = c === 'busy' || c === 'timeout' || c === 'session' ? (c as CodigoError) : 'internal';
      } else {
        const ev = data.evento as { titulo: string; cuando: string } | null | undefined;
        anadir(
          {
            id: nuevoId(),
            role: 'assistant',
            content: data.answer as string,
            kind: String(data.kind || ''),
            fuentes: Array.isArray(data.fuentes) ? (data.fuentes as Fuente[]) : undefined,
            foto: (data.foto as Msg['foto']) ?? undefined,
            evento: ev ? { titulo: ev.titulo, cuando: ev.cuando } : null,
          },
          'inicio'
        );
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') error = 'timeout';
      else error = navigator.onLine ? 'red' : 'offline';
    } finally {
      clearTimeout(temporizador);
      setPendiente(null);
    }

    if (error) {
      const auto = error === 'busy' && !opts.auto;
      const errMsg: Msg = {
        id: nuevoId(),
        role: 'assistant',
        content: '',
        error: {
          code: error,
          pregunta: texto,
          // El servidor ya recibió (y guardó) la pregunta salvo fallo de red.
          reintento: error !== 'red' && error !== 'offline',
          fotoDe: fotoKey,
          auto,
        },
      };
      anadir(errMsg, 'final');
      if (auto) {
        // Saturación puntual: un único reintento solo, pasado medio minuto,
        // si el usuario no ha seguido con otra cosa.
        setTimeout(() => {
          const sigue = messagesRef.current[messagesRef.current.length - 1]?.id === errMsg.id;
          if (sigue && !pendienteRef.current) reintentar(errMsg, true);
        }, 35_000);
      }
    }
  }

  function enviar() {
    if (pendiente) return;
    const texto = input.trim();
    if (!texto && !foto) return;
    const imagen = foto ?? undefined;
    setInput('');
    setFoto(null);
    setFotoError(null);
    preguntar(texto, { imagen });
  }

  function reintentar(m: Msg, auto = false) {
    if (!m.error) return;
    const img = m.error.fotoDe ? fotos.current.get(m.error.fotoDe) : undefined;
    if ((m.error.code === 'sin-foto' || m.error.fotoDe) && !img) {
      // La foto ya no está en memoria (se cerró la app): hay que volver a elegirla.
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      setInput(m.error.pregunta);
      fileRef.current?.click();
      return;
    }
    preguntar(m.error.pregunta, {
      imagen: img,
      fotoKey: m.error.fotoDe,
      reintento: m.error.reintento,
      quitarErrorId: m.id,
      auto,
    });
  }

  function responderEvento(m: Msg, si: boolean) {
    if (!m.evento) return;
    setMessages((prev) =>
      prev.map((x) => (x.id === m.id && x.evento ? { ...x, evento: { ...x.evento, respondido: true } } : x))
    );
    if (si) preguntar(`Recuérdame «${m.evento.titulo}» ${m.evento.cuando}`);
  }

  async function elegirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFotoError(null);
    try {
      setFoto(await reducirFoto(file));
      textareaRef.current?.focus();
    } catch {
      setFotoError('No he podido preparar esa foto. Prueba con otra o hazla de nuevo.');
    }
  }

  function borrarConversacion() {
    if (!confirm('¿Borrar esta conversación de la pantalla? Lo que te he apuntado no se borra.')) return;
    setMessages([]);
    try {
      localStorage.removeItem(clave);
    } catch {
      // nada
    }
  }

  const textoEspera = !pendiente
    ? ''
    : segundos >= 15
      ? 'Está tardando más de lo normal, sigo con ello…'
      : segundos >= 4
        ? pendiente.conFoto
          ? 'Leyendo la foto…'
          : 'Buscando la respuesta…'
        : 'Un momento…';

  const puedeEnviar = !pendiente && (!!input.trim() || !!foto);

  return (
    <main
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        top: vista ? vista.arriba : 0,
        height: vista ? vista.alto : '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-0)',
        color: 'var(--fg-0)',
        overflow: 'hidden',
        // iOS: el tamaño base sigue Ajustes → Pantalla → Tamaño del texto; los
        // textos del chat van en em. En otros navegadores la regla se ignora.
        font: '-apple-system-body',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <header
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: 'calc(8px + env(safe-area-inset-top)) 12px 8px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--overlay-bg)',
        }}
      >
        <span style={{ width: 44 }} />
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            fontWeight: 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Lexis
        </span>
        {messages.length > 0 ? (
          <button
            onClick={borrarConversacion}
            aria-label="Borrar la conversación de la pantalla"
            title="Borrar la conversación"
            style={{
              minWidth: 44,
              minHeight: 44,
              fontSize: 14,
              color: 'var(--fg-2)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Borrar
          </button>
        ) : (
          <span style={{ width: 44 }} />
        )}
      </header>

      {!online && (
        <div
          role="alert"
          style={{
            flexShrink: 0,
            padding: '8px 16px',
            fontSize: 15.5,
            textAlign: 'center',
            background: '#8a3b12',
            color: '#fff',
          }}
        >
          Sin conexión a internet. Cuando vuelva, puedes seguir.
        </div>
      )}

      <ActivarAvisos />

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '18px 16px' }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {cargado && messages.length === 0 && (
            <div style={{ fontSize: '1.06em', lineHeight: 1.55, padding: '8px 2px' }}>
              <div style={{ fontSize: '1.35em', fontWeight: 600, marginBottom: 6 }}>
                {nombre ? `Hola, ${nombre}.` : 'Hola.'}
              </div>
              <div style={{ color: 'var(--fg-1)' }}>
                Pregúntame lo que necesites, mándame una foto o pídeme que te recuerde algo. Por ejemplo:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
                {ejemplos.map((e, k) => (
                  <button
                    key={k}
                    onClick={() => {
                      if (e.completar) {
                        setInput(e.completar);
                        textareaRef.current?.focus();
                      } else {
                        preguntar(e.texto);
                      }
                    }}
                    style={{
                      textAlign: 'left',
                      minHeight: 48,
                      padding: '10px 14px',
                      fontSize: 17,
                      color: 'var(--fg-0)',
                      background: 'var(--bg-2)',
                      border: '1px solid var(--line-strong)',
                      borderRadius: 14,
                      cursor: 'pointer',
                    }}
                  >
                    {e.texto}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} data-id={m.id} style={{ ...burbuja, ...burbujaUsuario }}>
                {m.conFoto &&
                  (fotos.current.get(m.id) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fotos.current.get(m.id)!.url}
                      alt="Foto enviada"
                      style={{ display: 'block', maxWidth: '100%', maxHeight: 220, borderRadius: 10, marginBottom: m.content ? 8 : 0 }}
                    />
                  ) : (
                    <div style={{ opacity: 0.85, marginBottom: m.content ? 4 : 0 }}>📷 Foto</div>
                  ))}
                {m.content}
              </div>
            ) : m.error ? (
              <div key={m.id} data-id={m.id} style={{ ...burbuja, ...burbujaAsistente, borderColor: 'var(--line-strong)' }}>
                <div>
                  {MENSAJE_ERROR[m.error.code]}
                  {m.error.auto && ' Lo vuelvo a intentar yo solo en medio minuto.'}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                  {m.error.code === 'session' ? (
                    <a href="/auth/login?next=/asistente" style={{ ...botonAccion, textDecoration: 'none' }}>
                      Volver a entrar
                    </a>
                  ) : (
                    <button onClick={() => reintentar(m)} disabled={!!pendiente} style={botonAccion}>
                      {m.error.code === 'sin-foto' ? 'Elegir la foto otra vez' : 'Reintentar'}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div key={m.id} data-id={m.id} style={{ ...burbuja, ...burbujaAsistente }}>
                <Respuesta texto={m.content} />
                {m.fuentes && m.fuentes.length > 0 && <Fuentes fuentes={m.fuentes} />}
                {m.evento && !m.evento.respondido && (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                    <div>
                      ¿Quieres que te avise de «{m.evento.titulo}» {m.evento.cuando}?
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                      <button onClick={() => responderEvento(m, true)} disabled={!!pendiente} style={botonAccion}>
                        Sí, avísame
                      </button>
                      <button onClick={() => responderEvento(m, false)} style={botonNo}>
                        No
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          )}

          {pendiente && (
            <div style={{ ...burbuja, ...burbujaAsistente, color: 'var(--fg-2)' }} aria-live="polite">
              {textoEspera}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          flexShrink: 0,
          borderTop: '1px solid var(--line)',
          background: 'var(--bg-1)',
          padding: '10px 12px calc(10px + env(safe-area-inset-bottom))',
        }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {(foto || fotoError) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              {foto && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={foto.url} alt="Foto lista para enviar" style={{ height: 56, borderRadius: 8 }} />
                  <span style={{ fontSize: 15.5, color: 'var(--fg-1)', flex: 1 }}>
                    Escribe qué quieres saber de la foto, o envíala tal cual.
                  </span>
                  <button onClick={() => setFoto(null)} aria-label="Quitar la foto" style={botonNo}>
                    Quitar
                  </button>
                </>
              )}
              {fotoError && <span style={{ fontSize: 15.5, color: 'var(--fg-1)' }}>{fotoError}</span>}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={elegirFoto}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              aria-label="Enviar una foto"
              style={{
                flexShrink: 0,
                minWidth: 48,
                minHeight: 48,
                fontSize: 15,
                color: 'var(--fg-0)',
                background: 'var(--bg-2)',
                border: '1px solid var(--line-strong)',
                borderRadius: 14,
                cursor: 'pointer',
                padding: '0 10px',
              }}
            >
              📷 Foto
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  enviar();
                }
              }}
              placeholder="Escribe o toca el micrófono del teclado"
              aria-label="Tu mensaje"
              rows={1}
              enterKeyHint="send"
              style={{
                flex: 1,
                minWidth: 0,
                resize: 'none',
                fontSize: 'max(16px, 1em)',
                lineHeight: 1.4,
                padding: '12px 14px',
                minHeight: 48,
                boxSizing: 'border-box',
                borderRadius: 14,
                border: '1px solid var(--line-strong)',
                background: 'var(--input-bg)',
                color: 'var(--fg-0)',
                maxHeight: 160,
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={enviar}
              disabled={!puedeEnviar}
              style={{
                flexShrink: 0,
                minHeight: 48,
                fontSize: 16.5,
                fontWeight: 600,
                color: '#fff',
                background: 'var(--grad-accent)',
                border: 'none',
                borderRadius: 14,
                padding: '0 16px',
                cursor: puedeEnviar ? 'pointer' : 'default',
                opacity: puedeEnviar ? 1 : 0.5,
              }}
            >
              {pendiente ? '…' : 'Enviar'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------- Estilos ------------------------------------------------------

const burbuja: React.CSSProperties = {
  maxWidth: '90%',
  padding: '12px 16px',
  borderRadius: 16,
  fontSize: '1.06em',
  lineHeight: 1.55,
  wordBreak: 'break-word',
  whiteSpace: 'pre-wrap',
};

const burbujaUsuario: React.CSSProperties = {
  alignSelf: 'flex-end',
  background: 'var(--fg-0)',
  color: 'var(--bg-0)',
};

const burbujaAsistente: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: 'var(--bg-2)',
  color: 'var(--fg-0)',
  border: '1px solid var(--line)',
  boxShadow: 'var(--shadow-sm)',
};

const estiloDesplegable: React.CSSProperties = {
  cursor: 'pointer',
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--fg-1)',
  padding: '10px 0',
};

const botonAccion: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 44,
  padding: '8px 18px',
  fontSize: 16,
  fontWeight: 600,
  color: '#fff',
  background: 'var(--grad-accent)',
  border: 'none',
  borderRadius: 12,
  cursor: 'pointer',
};

const botonNo: React.CSSProperties = {
  minHeight: 44,
  padding: '8px 16px',
  fontSize: 16,
  color: 'var(--fg-1)',
  background: 'transparent',
  border: '1px solid var(--line-strong)',
  borderRadius: 12,
  cursor: 'pointer',
};
