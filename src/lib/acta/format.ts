export function fmtClock(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = String(m).padStart(2, '0');
  const sp = String(ss).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${sp}` : `${m}:${sp}`;
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export const STATUS_ES: Record<string, string> = {
  recording: 'grabando',
  uploaded: 'en cola',
  transcribing: 'transcribiendo',
  extracting: 'extrayendo',
  review: 'para revisar',
  synced: 'en Lexis',
  failed: 'error',
};

export interface RecordingRow {
  id: string;
  title: string | null;
  template_key: string;
  status: string;
  duration_s: number | null;
  started_at: string;
  audio_path?: string | null;
  audio_sessions?: string[];
  audio_purged_at?: string | null;
  language?: string;
  error?: string | null;
  brief?: { id: string; status: string; confidence: number | null } | null;
}

export interface TemplateSectionMeta {
  key: string;
  label: string;
  type: 'text' | 'list' | 'action_items' | 'entities';
  required: boolean;
}

export interface TemplateMeta {
  key: string;
  name: string;
  sections: TemplateSectionMeta[];
}

export interface BriefRow {
  id: string;
  recording_id: string;
  template_key: string;
  payload: Record<string, unknown>;
  summary_md: string;
  confidence: number | null;
  model_used: string | null;
  status: 'draft' | 'approved' | 'synced' | 'failed';
}

export interface Segment { start: number; end: number; text: string }
