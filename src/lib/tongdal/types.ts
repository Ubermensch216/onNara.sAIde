/**
 * TONGDAL.ai 브리지 API v1 응답 형식.
 *
 * ★ 계약의 원본은 TONGDAL.ai 저장소 `docs/tongdal-bridge-api.md`다. 저쪽이 바뀌면 여기를 함께 고친다.
 *   이 확장이 아는 판본은 `TONGDAL_API_VERSION` 하나이며, 다르면 연동을 끈다(tongdal/status.ts).
 */

export const TONGDAL_API_VERSION = 1;

export type TongdalScope = 'read' | 'write' | 'delete';

export interface TongdalStatus {
  apiVersion: number;
  app: { name: string; version: string };
  paired: boolean;
  scopes?: TongdalScope[];
  knowledgeSpace?: { connected: boolean; name: string | null };
  engine?: { state: 'ready' | 'starting' | 'error'; message: string | null };
  indexing?: { queueLength: number; isProcessing: boolean; currentFile: string | null };
  ollama?: { state: 'ready' | 'offline' | 'missing_models' | 'unknown'; missingModels: string[] };
  documents?: { total: number; indexed: number; failed: number } | null;
}

export interface TongdalPairResult {
  token: string;
  clientId: string;
  scopes: TongdalScope[];
  apiVersion: number;
}

export interface TongdalSearchHit {
  sourceDocumentId: string | null;
  title: string;
  fileName: string;
  relativePath: string;
  sectionPath: string;
  pageStart: number | null;
  pageEnd: number | null;
  text: string;
  truncated: boolean;
  score: number;
}

export interface TongdalSearchResult {
  results: TongdalSearchHit[];
  searchMode: 'hybrid' | 'keyword';
}

export interface TongdalShelf {
  id: string;
  parentId: string | null;
  name: string;
  description: string;
  documentCount: number;
}

export interface TongdalMetadata {
  project: string | null;
  year: number | null;
  organizations: string[];
  topics: string[];
  importance: string | null;
}

export interface TongdalDocumentSummary {
  id: string;
  title: string;
  shelfId: string | null;
  shelfName: string | null;
  documentType: string | null;
  status: string;
  updatedAt: number;
  metadata: TongdalMetadata;
  current: { versionLabel: string; relativePath: string | null; size: number; ext: string } | null;
}

export interface TongdalDocumentList {
  total: number;
  offset: number;
  limit: number;
  documents: TongdalDocumentSummary[];
}

export interface TongdalDocumentDetail {
  document: {
    id: string;
    title: string;
    shelfId: string | null;
    shelfName: string | null;
    documentType: string | null;
    status: string;
    createdAt: number;
    updatedAt: number;
    metadata: TongdalMetadata;
    versions: Array<{
      versionLabel: string;
      isCurrent: boolean;
      relativePath: string | null;
      size: number;
      ext: string;
      contentHash: string;
      createdAt: number;
    }>;
  };
  text: { content: string; truncated: boolean; indexed: boolean } | null;
}
