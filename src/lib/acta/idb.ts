// IndexedDB mínimo para resiliencia offline del grabador (S1).
// Los chunks viven aquí hasta confirmarse subidos a Storage: perder
// cobertura o cerrar la app no pierde audio ya troceado.

const DB_NAME = 'acta';
const DB_VERSION = 1;

export interface PendingChunk {
  key: string;          // `${recordingId}:${seq padded}`
  recordingId: string;
  session: number;      // sesión (~20 min) a la que pertenece; `seq` sigue siendo global
  seq: number;
  path: string;         // ruta destino en Storage
  mime: string;
  blob: Blob;
}

export interface ActiveMeta {
  id: 'active';
  recordingId: string;
  userId: string;
  mime: string;
  ext: string;
  session: number;      // sesión actual (~20 min)
  seq: number;          // siguiente seq a emitir (global)
  title: string | null;
  startedAt: number;    // epoch ms
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((res, rej) => {
        const t = db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      })
  );
}

export const putChunk = (c: PendingChunk) => tx('chunks', 'readwrite', (s) => s.put(c));
export const deleteChunk = (key: string) => tx('chunks', 'readwrite', (s) => s.delete(key));

export async function listChunks(recordingId: string): Promise<PendingChunk[]> {
  const all = await tx<PendingChunk[]>('chunks', 'readonly', (s) => s.getAll() as IDBRequest<PendingChunk[]>);
  return all.filter((c) => c.recordingId === recordingId).sort((a, b) => a.seq - b.seq);
}

export async function countChunks(recordingId: string): Promise<number> {
  return (await listChunks(recordingId)).length;
}

export const putMeta = (m: ActiveMeta) => tx('meta', 'readwrite', (s) => s.put(m));
export const clearMeta = () => tx('meta', 'readwrite', (s) => s.delete('active'));
export const getMeta = () =>
  tx<ActiveMeta | undefined>('meta', 'readonly', (s) => s.get('active') as IDBRequest<ActiveMeta | undefined>);
