// =====================================================
// Adapter: Google Drive
//
// Reutiliza el OAuth Google del Sprint 11 (scope drive.readonly).
//
// Estrategia:
//   - Primer run: list de archivos modificados en últimos N días
//     con filtros (folder, mime types, shared). Captura el
//     startPageToken actual para futuras deltas.
//   - Subsiguientes: Drive Changes API desde el pageToken guardado.
//     Procesa solo los archivos modificados/añadidos que pasen
//     los filtros del config.
//
// Tipos procesados:
//   - Google Docs    → export text/plain, source_type='text'
//   - Google Sheets  → export text/csv, source_type='xlsx'
//   - Google Slides  → export text/plain, source_type='text'
//   - Plain text/md  → download directo, source_type según
//   - PDF, Office    → solo metadata (titulo + URL) si
//                      include_metadata_only=true, sino skip
// =====================================================

import type {
  ConnectorAdapter,
  AdapterContext,
  AdapterRunResult,
  ConnectorItem,
} from '../types';
import type { SourceType } from '@/types/domain';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const MAX_ITEMS_PER_RUN = 15;
const MAX_TEXT_LENGTH = 40_000;
const FIRST_RUN_DAYS = 14;
const FIELDS_FILE =
  'id,name,mimeType,modifiedTime,createdTime,webViewLink,size,owners(displayName,emailAddress),sharedWithMe,trashed,parents';

// ============ Tipos ============

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  createdTime: string;
  webViewLink: string;
  size?: string;                // Drive devuelve size como string
  owners?: Array<{ displayName: string; emailAddress: string }>;
  sharedWithMe?: boolean;
  trashed?: boolean;
  parents?: string[];
}

interface DriveListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
}

interface DriveChange {
  fileId: string;
  removed?: boolean;
  file?: DriveFile;
  changeType?: 'file' | 'drive';
  time: string;
}

interface DriveChangesResponse {
  changes?: DriveChange[];
  nextPageToken?: string;
  newStartPageToken?: string;
}

interface DriveStartPageTokenResponse {
  startPageToken: string;
}

// ============ MIME maps ============

interface ExportRule {
  exportMime: string;
  sourceType: SourceType;
}

const EXPORTABLE: Record<string, ExportRule> = {
  'application/vnd.google-apps.document': {
    exportMime: 'text/plain',
    sourceType: 'text',
  },
  'application/vnd.google-apps.spreadsheet': {
    exportMime: 'text/csv',
    sourceType: 'xlsx',
  },
  'application/vnd.google-apps.presentation': {
    exportMime: 'text/plain',
    sourceType: 'text',
  },
};

const DIRECT_DOWNLOAD: Record<string, SourceType> = {
  'text/plain': 'text',
  'text/markdown': 'md',
  'text/csv': 'xlsx',
};

const METADATA_ONLY_SOURCE_TYPE: Record<string, SourceType> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'text',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'text',
  'application/msword': 'text',
  'application/vnd.ms-excel': 'xlsx',
};

const MIME_TYPE_OPTIONS = [
  { value: 'docs', label: 'Google Docs', mimes: ['application/vnd.google-apps.document'] },
  { value: 'sheets', label: 'Google Sheets', mimes: ['application/vnd.google-apps.spreadsheet'] },
  { value: 'slides', label: 'Google Slides', mimes: ['application/vnd.google-apps.presentation'] },
  { value: 'pdf', label: 'PDF', mimes: ['application/pdf'] },
  { value: 'office', label: 'Office (Word, Excel, PowerPoint)', mimes: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ]},
  { value: 'plain', label: 'Texto plano y Markdown', mimes: ['text/plain', 'text/markdown'] },
];

function resolveMimesFromConfig(selectedKeys: string[]): string[] {
  if (!selectedKeys || selectedKeys.length === 0) {
    // Default: solo Docs (más procesable)
    return ['application/vnd.google-apps.document'];
  }
  const mimes: string[] = [];
  for (const key of selectedKeys) {
    const opt = MIME_TYPE_OPTIONS.find((o) => o.value === key);
    if (opt) mimes.push(...opt.mimes);
  }
  return mimes;
}

// ============ Helpers de fetch ============

async function driveFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Drive API ${path} → ${res.status}: ${t.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function driveFetchText(path: string, accessToken: string): Promise<string> {
  const res = await fetch(`${DRIVE_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Drive download ${path} → ${res.status}: ${t.slice(0, 200)}`);
  }
  // Limitar lectura para no atragantarse con archivos enormes
  const text = await res.text();
  return text.slice(0, MAX_TEXT_LENGTH);
}

async function getStartPageToken(accessToken: string): Promise<string> {
  const data = await driveFetch<DriveStartPageTokenResponse>(
    '/changes/startPageToken?supportsAllDrives=false',
    accessToken
  );
  return data.startPageToken;
}

// ============ Filtros ============

function buildListQuery(
  mimes: string[],
  folderId: string | null,
  includeShared: boolean,
  firstRunFilter: boolean
): string {
  const parts: string[] = ['trashed=false'];

  if (mimes.length > 0) {
    const mimeClause = mimes.map((m) => `mimeType='${m}'`).join(' or ');
    parts.push(`(${mimeClause})`);
  }

  // Folder: solo si no estamos en modo "shared with me"
  if (folderId) {
    parts.push(`'${folderId}' in parents`);
  }

  if (firstRunFilter) {
    const cutoff = new Date(Date.now() - FIRST_RUN_DAYS * 86400_000)
      .toISOString();
    parts.push(`modifiedTime > '${cutoff}'`);
  }

  let q = parts.join(' and ');

  // Combinar con sharedWithMe vía OR si el user quiere ambos.
  // Drive query language no soporta agrupaciones complejas con OR + sharedWithMe limpiamente,
  // así que para shared usamos un segundo list (manejado en el caller).
  return q;
}

function fileMatchesConfig(
  file: DriveFile,
  mimes: string[],
  folderId: string | null,
  includeShared: boolean
): boolean {
  if (file.trashed) return false;
  if (mimes.length > 0 && !mimes.includes(file.mimeType)) return false;
  if (folderId && !(file.parents || []).includes(folderId)) {
    // Si pidió shared y este es shared, pasa
    if (!(includeShared && file.sharedWithMe)) return false;
  }
  return true;
}

// ============ Extracción de contenido ============

async function extractContent(
  file: DriveFile,
  accessToken: string,
  includeMetadataOnly: boolean
): Promise<{ text: string | null; sourceType: SourceType }> {
  // 1. Exportables (Google Docs / Sheets / Slides)
  const exportRule = EXPORTABLE[file.mimeType];
  if (exportRule) {
    const text = await driveFetchText(
      `/files/${file.id}/export?mimeType=${encodeURIComponent(exportRule.exportMime)}`,
      accessToken
    );
    return { text, sourceType: exportRule.sourceType };
  }

  // 2. Plain text / markdown / csv: download directo
  const directType = DIRECT_DOWNLOAD[file.mimeType];
  if (directType) {
    const text = await driveFetchText(
      `/files/${file.id}?alt=media`,
      accessToken
    );
    return { text, sourceType: directType };
  }

  // 3. Metadata-only para PDF / Office
  const metadataType = METADATA_ONLY_SOURCE_TYPE[file.mimeType];
  if (metadataType && includeMetadataOnly) {
    return { text: '', sourceType: metadataType };
  }

  // 4. Tipo no soportado
  return { text: null, sourceType: 'text' };
}

async function fileToItem(
  file: DriveFile,
  accessToken: string,
  config: { include_metadata_only: boolean; min_content_length: number }
): Promise<ConnectorItem | null> {
  let result;
  try {
    result = await extractContent(file, accessToken, config.include_metadata_only);
  } catch (e) {
    console.error(`Drive: error extrayendo ${file.id} (${file.name})`, e);
    return null;
  }

  if (result.text === null) return null;             // tipo no soportado

  // Para archivos con contenido extraído, aplicar mínimo
  const hasContent = result.text.trim().length > 0;
  if (hasContent && result.text.trim().length < config.min_content_length) {
    return null;
  }

  const title = file.name;
  const body = result.text.trim();
  const content = body
    ? `${title}\n\n${body}`.slice(0, MAX_TEXT_LENGTH)
    : `${title}\n\n[Archivo de tipo ${file.mimeType} — solo metadatos, sin contenido extraído]`;

  const owner = file.owners?.[0];

  return {
    external_id: `drive_${file.id}`,
    content,
    source_type: result.sourceType,
    source_uri: file.webViewLink,
    captured_at: file.modifiedTime,
    extra_metadata: {
      drive_file_id: file.id,
      drive_mime_type: file.mimeType,
      drive_modified_time: file.modifiedTime,
      drive_created_time: file.createdTime,
      drive_owner_name: owner?.displayName,
      drive_owner_email: owner?.emailAddress,
      drive_shared_with_me: file.sharedWithMe ?? false,
      drive_size_bytes: file.size ? parseInt(file.size) : null,
      drive_folder_ids: file.parents ?? [],
      content_extracted: hasContent,
    },
  };
}

// ============ Adapter ============

export const driveAdapter: ConnectorAdapter = {
  type: 'drive',
  label: 'Google Drive',
  description:
    'Polea archivos modificados de Google Drive y captura su contenido. Procesa Docs, Sheets, Slides, texto plano y markdown. PDFs y Office se capturan como metadata.',
  glyph: '◰',
  oauth_provider: 'google',
  supports_schedule: true,
  supports_webhook: false,

  config_schema: [
    {
      key: 'folder_id',
      label: 'ID de carpeta (opcional)',
      type: 'text',
      description:
        'ID de la carpeta de Drive a vigilar. Vacío = toda la cuenta. El ID está al final de la URL cuando abres la carpeta en Drive.',
      placeholder: '1a2B3c4D5e6F7g8H9i0J',
    },
    {
      key: 'mime_types',
      label: 'Tipos de archivo a capturar',
      type: 'select',
      description: 'Tipos que quieres procesar. Si no eliges, default: solo Google Docs.',
      default: 'docs',
      options: [
        { value: 'docs', label: 'Solo Google Docs' },
        { value: 'docs,sheets', label: 'Docs + Sheets' },
        { value: 'docs,sheets,slides', label: 'Docs + Sheets + Slides' },
        { value: 'docs,sheets,slides,plain', label: 'Google Workspace + texto plano' },
        { value: 'docs,sheets,slides,plain,pdf,office', label: 'Todo (PDFs/Office solo metadata)' },
      ],
    },
    {
      key: 'include_shared',
      label: 'Incluir archivos compartidos conmigo',
      type: 'boolean',
      description:
        'Si activo, también captura archivos de otras cuentas compartidos contigo.',
      default: false,
    },
    {
      key: 'include_metadata_only',
      label: 'Capturar metadata de PDF/Office',
      type: 'boolean',
      description:
        'Sprint 12 no extrae texto de PDFs y Office. Si activo, los archivos se capturan con solo título + URL.',
      default: false,
    },
    {
      key: 'max_per_run',
      label: 'Máximo de archivos por ejecución',
      type: 'number',
      description: 'Tope por run. Archivos modificados frecuentemente saturarían si está demasiado alto.',
      default: 10,
    },
    {
      key: 'min_content_length',
      label: 'Longitud mínima del contenido',
      type: 'number',
      description: 'Caracteres mínimos para considerar el archivo capturable. Evita capturar archivos casi vacíos.',
      default: 100,
    },
  ],

  validate_config(config) {
    const folderId = config.folder_id as string;
    if (folderId && !/^[a-zA-Z0-9_-]{8,}$/.test(folderId)) {
      return { ok: false, error: 'folder_id no parece un ID válido de Drive' };
    }
    return { ok: true };
  },

  async run(ctx: AdapterContext): Promise<AdapterRunResult> {
    if (!ctx.credentials?.access_token) {
      throw new Error('Falta access_token. Reautoriza la cuenta de Google.');
    }
    const accessToken = ctx.credentials.access_token;

    const folderId = (ctx.config.folder_id as string) || null;
    const mimesKey = (ctx.config.mime_types as string) || 'docs';
    const mimes = resolveMimesFromConfig(mimesKey.split(','));
    const includeShared = (ctx.config.include_shared as boolean) ?? false;
    const includeMetadataOnly =
      (ctx.config.include_metadata_only as boolean) ?? false;
    const maxPerRun = Math.min(
      (ctx.config.max_per_run as number) || 10,
      MAX_ITEMS_PER_RUN
    );
    const minContentLength = (ctx.config.min_content_length as number) || 100;

    const lastPageToken = (ctx.state.last_page_token as string) || null;
    const candidateFiles: DriveFile[] = [];
    const debug: Record<string, unknown> = { mimes, folder_id: folderId };

    let newStartPageToken: string | null = lastPageToken;

    // ============ Estrategia 1: incremental con Changes API ============

    if (lastPageToken) {
      try {
        let pageToken: string | undefined = lastPageToken;
        let changeCalls = 0;

        while (pageToken && candidateFiles.length < maxPerRun * 3 && changeCalls < 5) {
          const params = new URLSearchParams({
            pageToken,
            pageSize: '100',
            fields: `changes(fileId,removed,changeType,time,file(${FIELDS_FILE})),nextPageToken,newStartPageToken`,
          });
          const data: DriveChangesResponse = await driveFetch(
            `/changes?${params.toString()}`,
            accessToken
          );
          changeCalls++;

          for (const change of data.changes || []) {
            if (change.removed || !change.file) continue;
            if (fileMatchesConfig(change.file, mimes, folderId, includeShared)) {
              candidateFiles.push(change.file);
            }
          }

          if (data.newStartPageToken) {
            newStartPageToken = data.newStartPageToken;
          }
          pageToken = data.nextPageToken;
        }

        debug.mode = 'incremental';
        debug.change_calls = changeCalls;
      } catch (e: any) {
        const msg = String(e);
        if (msg.includes('404') || msg.includes('410')) {
          // PageToken caducado; fallback a list
          debug.fallback_reason = 'page_token_expired';
        } else {
          throw e;
        }
      }
    }

    // ============ Estrategia 2: list (primer run o fallback) ============

    if (!lastPageToken || debug.fallback_reason) {
      // Capturar startPageToken ANTES de listar para no perder cambios
      // que ocurran durante la lista
      try {
        newStartPageToken = await getStartPageToken(accessToken);
      } catch (e) {
        console.error('Drive: no se pudo obtener startPageToken', e);
      }

      const q = buildListQuery(mimes, folderId, false, !lastPageToken);
      const params = new URLSearchParams({
        q,
        pageSize: String(Math.min(maxPerRun * 2, 50)),
        orderBy: 'modifiedTime desc',
        fields: `files(${FIELDS_FILE}),nextPageToken`,
      });
      const list = await driveFetch<DriveListResponse>(
        `/files?${params.toString()}`,
        accessToken
      );
      candidateFiles.push(...(list.files || []));

      // Segundo list para shared with me si está activo
      if (includeShared && candidateFiles.length < maxPerRun) {
        const qShared = buildListQuery(mimes, null, true, !lastPageToken)
          + ' and sharedWithMe=true';
        const paramsShared = new URLSearchParams({
          q: qShared,
          pageSize: String(maxPerRun),
          orderBy: 'modifiedTime desc',
          fields: `files(${FIELDS_FILE})`,
        });
        try {
          const listShared = await driveFetch<DriveListResponse>(
            `/files?${paramsShared.toString()}`,
            accessToken
          );
          candidateFiles.push(...(listShared.files || []));
        } catch (e) {
          console.error('Drive: error listando shared', e);
        }
      }

      if (!lastPageToken) debug.mode = 'first_run';
    }

    // Dedup por ID (las dos listas pueden solapar)
    const seen = new Set<string>();
    const uniqueFiles = candidateFiles.filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });

    // Cap aplicado
    const toProcess = uniqueFiles.slice(0, maxPerRun);
    debug.candidates_total = uniqueFiles.length;
    debug.files_to_process = toProcess.length;

    // Mapear a items con extracción
    const items: ConnectorItem[] = [];
    for (const file of toProcess) {
      const item = await fileToItem(file, accessToken, {
        include_metadata_only: includeMetadataOnly,
        min_content_length: minContentLength,
      });
      if (item) items.push(item);
    }

    return {
      items,
      new_state: {
        last_page_token: newStartPageToken,
        last_run_at: new Date().toISOString(),
        folder_id: folderId,
        mimes_resolved: mimes,
      },
      debug,
    };
  },
};
