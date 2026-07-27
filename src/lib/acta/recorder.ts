// ACTA · Grabador (S1). [VALIDAR EN DISPOSITIVOS REALES — checklist S6]
//
// Diseño:
//  - MediaRecorder con timeslice de 45 s: dentro de una SESIÓN, cada chunk es
//    un corte de bytes de un único contenedor (iOS: audio/mp4 fMP4; Android:
//    webm/opus); el servidor los une por concatenación binaria.
//  - SESIONES (~20 min): cada tramo abre una instancia NUEVA de MediaRecorder
//    sobre el mismo stream. Cada sesión es un contenedor independiente y
//    completo; el servidor las transcribe por separado y cose los transcripts
//    por offset de tiempo. Así una reunión no tiene límite práctico de
//    duración y ningún fichero se acerca al tope de 40 MB de Groq (free).
//    `seq` es GLOBAL y monótono en toda la grabación; `session` es solo el
//    índice de agrupación (coincide con la columna `session` de la BD).
//  - Cada chunk va primero a IndexedDB y de ahí un uploader secuencial lo
//    sube a Storage e inserta su fila. Perder red o cerrar la app pierde
//    como mucho el chunk parcial en curso.
//  - Wake lock (Safari >= 16.4) + reintento en visibilitychange: en iOS la
//    pantalla apagada suspende la grabación; la UI lo avisa.

import { getSupabase } from './api';
import {
  ActiveMeta,
  clearMeta,
  countChunks,
  deleteChunk,
  listChunks,
  putChunk,
  putMeta,
} from './idb';

export interface MimeInfo {
  mime: string;
  ext: string;
}

export function pickMime(): MimeInfo | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates: Array<[string, string]> = [
    ['audio/mp4', 'm4a'],
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/webm', 'webm'],
  ];
  for (const [mime, ext] of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return null;
}

const TIMESLICE_MS = 45_000;
const SESSION_MS = 20 * 60_000; // corte de sesión: nueva instancia MediaRecorder cada ~20 min
const AUDIO_BPS = 64_000; // ~10 MB por sesión de 20 min → holgado bajo el tope de 40 MB de Groq (free)
const RETRY_MS = 3_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// =====================================================
// Uploader: drena IndexedDB → Storage + fila en BD.
// Idempotente: upsert en Storage y 23505 tolerado en la fila,
// así reintentar tras un corte nunca duplica.
// =====================================================

export class ChunkUploader {
  private running = false;

  constructor(
    private recordingId: string,
    private userId: string,
    private onPending: (n: number) => void,
    private onError: (msg: string) => void
  ) {}

  kick(): void {
    if (!this.running) void this.loop();
  }

  private async loop(): Promise<void> {
    this.running = true;
    try {
      for (;;) {
        const items = await listChunks(this.recordingId);
        this.onPending(items.length);
        if (items.length === 0) break;
        const c = items[0];
        try {
          const up = await getSupabase()
            .storage.from('acta-audio')
            .upload(c.path, c.blob, { contentType: c.mime, upsert: true });
          if (up.error) throw up.error;

          const ins = await getSupabase().from('acta_recording_chunks').insert({
            recording_id: c.recordingId,
            user_id: this.userId,
            session: c.session ?? 0,
            seq: c.seq,
            storage_path: c.path,
            size_bytes: c.blob.size,
          });
          if (ins.error && ins.error.code !== '23505') throw ins.error;

          await deleteChunk(c.key);
        } catch (err) {
          this.onError(err instanceof Error ? err.message : String(err));
          await sleep(RETRY_MS);
        }
      }
    } finally {
      this.running = false;
    }
  }

  async drain(): Promise<void> {
    while ((await countChunks(this.recordingId)) > 0) {
      this.kick();
      await sleep(500);
    }
    this.onPending(0);
  }
}

// =====================================================
// Recorder
// =====================================================

export interface RecorderCallbacks {
  onElapsed: (seconds: number) => void;
  onLevel: (v: number) => void; // 0..1
  onPending: (n: number) => void;
  onError: (msg: string) => void;
  onScreenHidden: () => void; // aviso UX iOS
}

export class ActaRecorder {
  readonly uploader: ChunkUploader;

  private mr: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private raf = 0;
  private tickTimer = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private wakeLock: any = null;

  private seq = 0;
  private session = 0;
  private startedAt = 0;
  private pausedAccum = 0;
  private pauseStart = 0;
  private sessionStartedAt = 0;
  private sessionPausedAccum = 0;
  private rolling = false;
  private stopPromise: Promise<{ chunks: number; durationS: number; sessions: number }> | null = null;
  state: 'idle' | 'rec' | 'paused' | 'stopping' = 'idle';

  private visHandler = () => {
    if (document.visibilityState === 'visible') {
      if (this.state === 'rec') void this.acquireWakeLock();
    } else if (this.state === 'rec') {
      this.cb.onScreenHidden();
    }
  };

  constructor(
    private recordingId: string,
    private userId: string,
    private mimeInfo: MimeInfo,
    private title: string | null,
    private cb: RecorderCallbacks
  ) {
    this.uploader = new ChunkUploader(recordingId, userId, cb.onPending, cb.onError);
  }

  private newRecorder(): MediaRecorder {
    const mr = new MediaRecorder(this.stream!, {
      mimeType: this.mimeInfo.mime,
      audioBitsPerSecond: AUDIO_BPS, // iOS puede ignorarlo; el corte por sesión ya acota el tamaño
    });
    mr.ondataavailable = (e) => void this.handleChunk(e.data);
    mr.onerror = () => this.cb.onError('MediaRecorder error');
    return mr;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    this.mr = this.newRecorder();
    this.mr.start(TIMESLICE_MS);

    this.startedAt = Date.now();
    this.sessionStartedAt = this.startedAt;
    this.state = 'rec';
    await this.persistMeta();
    await this.acquireWakeLock();
    this.startLevelMeter();
    this.tickTimer = window.setInterval(() => {
      this.cb.onElapsed(this.elapsedS());
      if (this.state === 'rec' && this.sessionElapsedS() >= SESSION_MS / 1000) void this.rollSession();
    }, 500);
    document.addEventListener('visibilitychange', this.visHandler);
  }

  private elapsedS(): number {
    const pausedNow = this.state === 'paused' ? Date.now() - this.pauseStart : 0;
    return (Date.now() - this.startedAt - this.pausedAccum - pausedNow) / 1000;
  }

  private sessionElapsedS(): number {
    const pausedNow = this.state === 'paused' ? Date.now() - this.pauseStart : 0;
    return (Date.now() - this.sessionStartedAt - this.sessionPausedAccum - pausedNow) / 1000;
  }

  /** Corte de sesión: cierra el contenedor actual y abre uno nuevo en el mismo
   *  stream. El ondataavailable final pertenece aún a la sesión en curso; solo
   *  después se incrementa `session`. Hueco de audio entre sesiones ~ms. */
  private async rollSession(): Promise<void> {
    if (this.state !== 'rec' || !this.mr || this.rolling) return;
    this.rolling = true;
    try {
      const old = this.mr;
      await new Promise<void>((res) => {
        old.onstop = () => res();
        old.stop();
      });
      this.session += 1;
      this.sessionStartedAt = Date.now();
      this.sessionPausedAccum = 0;
      const mr = this.newRecorder();
      mr.start(TIMESLICE_MS);
      this.mr = mr;
      await this.persistMeta();
    } catch (e) {
      this.cb.onError(e instanceof Error ? e.message : String(e));
    } finally {
      this.rolling = false;
    }
  }

  private async persistMeta(): Promise<void> {
    const meta: ActiveMeta = {
      id: 'active',
      recordingId: this.recordingId,
      userId: this.userId,
      mime: this.mimeInfo.mime,
      ext: this.mimeInfo.ext,
      session: this.session,
      seq: this.seq,
      title: this.title,
      startedAt: this.startedAt,
    };
    await putMeta(meta);
  }

  private async handleChunk(blob: Blob): Promise<void> {
    if (!blob || blob.size === 0) return;
    const seq = this.seq++;
    const session = this.session;
    const padded = String(seq).padStart(5, '0');
    const path = `${this.userId}/${this.recordingId}/s${session}/${padded}.${this.mimeInfo.ext}`;
    await putChunk({
      key: `${this.recordingId}:${padded}`,
      recordingId: this.recordingId,
      session,
      seq,
      path,
      mime: this.mimeInfo.mime,
      blob,
    });
    await this.persistMeta();
    this.cb.onPending(await countChunks(this.recordingId));
    this.uploader.kick();
  }

  pause(): void {
    if (this.state !== 'rec' || !this.mr || this.rolling) return; // evita pausar a mitad de un corte de sesión
    this.mr.pause();
    this.pauseStart = Date.now();
    this.state = 'paused';
  }

  resume(): void {
    if (this.state !== 'paused' || !this.mr || this.rolling) return;
    this.mr.resume();
    const delta = Date.now() - this.pauseStart;
    this.pausedAccum += delta;
    this.sessionPausedAccum += delta;
    this.state = 'rec';
    void this.acquireWakeLock();
  }

  /** Para, drena la subida y limpia. Devuelve duración, nº de chunks y sesiones.
   *  Idempotente: si ya se llamó (p. ej. el usuario reintentó "Terminar" tras
   *  un fallo de red en el finalize del backend), devuelve el mismo resultado
   *  en vez de volver a tocar un MediaRecorder ya detenido (lo que lanzaría
   *  InvalidStateError). NO limpia IndexedDB — eso lo hace `confirmDone()`
   *  una vez el backend confirma el finalize, para que si esa llamada falla
   *  la grabación siga siendo recuperable desde el banner de Home. */
  async stop(): Promise<{ chunks: number; durationS: number; sessions: number }> {
    if (!this.stopPromise) this.stopPromise = this.doStop();
    return this.stopPromise;
  }

  private async doStop(): Promise<{ chunks: number; durationS: number; sessions: number }> {
    if (!this.mr) throw new Error('recorder no iniciado');
    this.state = 'stopping'; // impide nuevos cortes de sesión
    while (this.rolling) await sleep(50); // espera si hay un corte en curso
    const durationS = Math.round(this.elapsedS());

    await new Promise<void>((res) => {
      this.mr!.onstop = () => res();
      this.mr!.stop(); // dispara el ondataavailable final antes de onstop
    });

    this.teardownMedia();
    await this.uploader.drain();
    return { chunks: this.seq, durationS, sessions: this.session + 1 };
  }

  /** Llamar tras confirmar que el backend aceptó el finalize: solo entonces
   *  se borra el rastro en IndexedDB. Si no se llama (finalize falló), Home
   *  sigue viendo la meta activa y ofrece "Reanudar subida y procesar". */
  async confirmDone(): Promise<void> {
    await clearMeta();
  }

  /** Limpieza de emergencia (salir sin finalizar): el audio queda en IDB. */
  abandon(): void {
    this.teardownMedia();
  }

  private teardownMedia(): void {
    document.removeEventListener('visibilitychange', this.visHandler);
    window.clearInterval(this.tickTimer);
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }

  private async acquireWakeLock(): Promise<void> {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request(t: string): Promise<unknown> } }).wakeLock;
      if (wl) this.wakeLock = await wl.request('screen');
    } catch {
      /* sin wake lock: la UI ya avisa de mantener pantalla encendida */
    }
  }

  private startLevelMeter(): void {
    try {
      this.audioCtx = new AudioContext();
      void this.audioCtx.resume().catch(() => undefined);
      const src = this.audioCtx.createMediaStreamSource(this.stream!);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) {
          const d = (v - 128) / 128;
          sum += d * d;
        }
        this.cb.onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3));
        this.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      /* medidor opcional */
    }
  }
}
