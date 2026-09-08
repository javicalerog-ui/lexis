'use client';

// =====================================================
// Chat del modo Silvestre: una sola pantalla, sin pestañas.
// Una caja de texto para todo — el backend decide si es una pregunta de datos
// de negocio o de su memoria. Diseño amplio y legible (usuario senior, móvil).
// =====================================================

import { useState, useRef, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const SALUDO =
  'Hola. Puedes preguntarme por las ventas, la cuota frente al sector, los precios medios, las compras a proveedores… o pedirme que recuerde algo. ¿Qué necesitas?';

// Render mínimo y seguro de markdown ligero (negritas y saltos), sin HTML crudo.
function Formateado({ texto }: { texto: string }) {
  const lineas = texto.split('\n');
  return (
    <>
      {lineas.map((linea, i) => {
        const partes = linea.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
          p.startsWith('**') && p.endsWith('**') ? (
            <strong key={j}>{p.slice(2, -2)}</strong>
          ) : (
            <span key={j}>{p}</span>
          )
        );
        return (
          <div key={i} style={{ minHeight: linea ? undefined : 8 }}>
            {partes}
          </div>
        );
      })}
    </>
  );
}

export function AssistantChat() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: SALUDO },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function enviar() {
    const pregunta = input.trim();
    if (!pregunta || busy) return;
    setInput('');
    const nuevo: Msg[] = [...messages, { role: 'user', content: pregunta }];
    setMessages(nuevo);
    setBusy(true);
    try {
      const historial = nuevo.slice(-8).map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pregunta, historial }),
      });
      const data = await res.json();
      const answer =
        (res.ok && typeof data.answer === 'string' && data.answer) ||
        'No he podido responder a eso ahora mismo. ¿Lo intentamos de otra forma?';
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Ha habido un problema de conexión. Reinténtalo en un momento.' },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function salir() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/auth/login';
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        background: 'var(--bg-0)',
        color: 'var(--fg-0)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--overlay-bg)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 17,
            fontWeight: 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Lexis
        </span>
        <button
          onClick={salir}
          style={{
            fontSize: 14,
            color: 'var(--fg-2)',
            background: 'transparent',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-full)',
            padding: '6px 14px',
            cursor: 'pointer',
          }}
        >
          Salir
        </button>
      </header>

      <div ref={scrollRef} style={{ overflowY: 'auto', padding: '20px 16px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '88%',
                padding: '12px 16px',
                borderRadius: 16,
                fontSize: 16.5,
                lineHeight: 1.55,
                background: m.role === 'user' ? 'var(--grad-accent)' : 'var(--bg-2)',
                color: m.role === 'user' ? '#fff' : 'var(--fg-0)',
                border: m.role === 'user' ? 'none' : '1px solid var(--line)',
                boxShadow: 'var(--shadow-sm)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {m.role === 'assistant' ? <Formateado texto={m.content} /> : m.content}
            </div>
          ))}
          {busy && (
            <div
              style={{
                alignSelf: 'flex-start',
                padding: '12px 16px',
                borderRadius: 16,
                fontSize: 16,
                color: 'var(--fg-2)',
                background: 'var(--bg-2)',
                border: '1px solid var(--line)',
              }}
            >
              Pensando…
            </div>
          )}
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--line)', background: 'var(--bg-1)', padding: '12px 16px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
            placeholder="Escribe tu pregunta…"
            rows={1}
            disabled={busy}
            style={{
              flex: 1,
              resize: 'none',
              fontSize: 16.5,
              lineHeight: 1.4,
              padding: '12px 14px',
              borderRadius: 14,
              border: '1px solid var(--line-strong)',
              background: 'var(--input-bg)',
              color: 'var(--fg-0)',
              maxHeight: 140,
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={enviar}
            disabled={busy || !input.trim()}
            style={{
              flexShrink: 0,
              fontSize: 16,
              fontWeight: 600,
              color: '#fff',
              background: 'var(--grad-accent)',
              border: 'none',
              borderRadius: 14,
              padding: '12px 20px',
              cursor: busy || !input.trim() ? 'default' : 'pointer',
              opacity: busy || !input.trim() ? 0.5 : 1,
            }}
          >
            Enviar
          </button>
        </div>
      </div>
    </main>
  );
}
