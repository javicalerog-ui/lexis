// =====================================================
// Tipos del dominio Lexis
// =====================================================

export type SourceType =
  | 'text'
  | 'voice'
  | 'image'
  | 'pdf'
  | 'xlsx'
  | 'md'
  | 'url';

export type MemoryStatus = 'active' | 'superseded' | 'archived';

export interface Memory {
  id: string;
  user_id: string;
  content: string;
  summary: string | null;
  raw_excerpt: string | null;
  source_type: SourceType;
  source_uri: string | null;
  source_metadata: Record<string, unknown>;
  embedding: number[] | null;
  captured_at: string;
  ingested_at: string;
  status: MemoryStatus;
}

export interface MemorySearchResult {
  id: string;
  content: string;
  summary: string | null;
  source_type: SourceType;
  captured_at: string;
  similarity: number;
}

export type ProjectStatus = 'active' | 'paused' | 'archived' | 'done';

export interface Project {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProjectStatus;
  rolling_summary: string | null;
  rolling_next_steps: string | null;
  rolling_summary_updated_at: string | null;
  embedding: number[] | null;
  last_activity_at: string | null;
  created_at: string;
}

export type EntityType = 'person' | 'org' | 'place' | 'concept' | 'product';

export interface Entity {
  id: string;
  user_id: string;
  name: string;
  entity_type: EntityType;
  aliases: string[];
  attributes: Record<string, unknown>;
  rolling_summary: string | null;
  embedding: number[] | null;
  created_at: string;
  last_seen_at: string | null;
}

// ----- Ingestión -----
export interface IngestionInput {
  source_type: SourceType;
  raw_text: string;                    // texto plano ya extraído (PDF, XLSX → narrativa)
  source_uri?: string;                 // ruta en Supabase Storage si aplica
  source_metadata?: Record<string, unknown>;
  captured_at?: string;                // ISO. Si no, se usa now()
}

export interface IngestionResult {
  memory_id: string;
  decision: 'new' | 'modification' | 'redundant' | 'unclear';
  summary: string;
  confidence: number;
  attached_projects?: Array<{
    project_id: string;
    slug: string;
    name: string;
    created: boolean;
  }>;
  attached_entities?: Array<{
    entity_id: string;
    name: string;
    entity_type: EntityType;
    created: boolean;
  }>;
}

// ----- LLM -----
export type LLMTier = 'fast' | 'deep';

export interface LLMCallOptions {
  tier?: LLMTier;
  temperature?: number;
  max_tokens?: number;
  system?: string;
  json?: boolean;
}

export interface LLMResponse {
  text: string;
  model_used: string;
  tier_used: LLMTier;
  prompt_tokens: number;
  completion_tokens: number;
}
