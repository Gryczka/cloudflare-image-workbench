/** JSON shapes returned by the API, declared for browser code without Worker binding types. */
import type { SourceFile } from './inspector';

export type Mode = 'center' | 'auto' | 'ai';
export type PresetKey = 'feature' | 'portrait' | 'square';

export interface CropSet {
  key: PresetKey;
  label: string;
  width: number;
  height: number;
  modes: { mode: Mode; url: string | null }[];
}

export interface SourceSnapshot {
  version: string;
  code: SourceFile[];
}

export interface SourceIdentity {
  objectKey: string | null;
  sha256: string | null;
  bytes: number | null;
  mime: string;
  width: number;
  height: number;
}

export interface Derivative {
  asset: string;
  objectKey: string;
  sourceKey: string | null;
  sourceBytes: number | null;
  outputBytes: number;
  transform: Record<string, unknown>;
  output: { format: string; quality: number; anim: boolean };
  transformMs: number;
  storedAt: string;
}

export interface EditorialRecord {
  kind: 'editorial';
  source: SourceIdentity;
  snapshots: { pipeline: SourceSnapshot; 'editorial-ai': SourceSnapshot };
  startedAt: string;
  finishedAt: string;
  status: 'ready' | 'partial';
  stepsCompleted: string[];
  preview: Derivative;
  crops: Derivative[];
  analysis: {
    focal: { x: number; y: number } | null;
    focalSource: string;
    writingModel: string | null;
    focalModel: string | null;
  };
}

export interface CreativeRecord {
  kind: 'creative';
  source: SourceIdentity;
  snapshot: SourceSnapshot;
  finishedAt: string;
  stepsCompleted: string[];
  model: string;
  style: string;
  prompt: string;
  generation?: { width: number; height: number; seed: number };
  reference: Derivative;
  output: Derivative;
  inferenceMs?: number;
  generationMs: number;
}

export interface RunRecords {
  editorial: EditorialRecord | null;
  creative: CreativeRecord | null;
}

export interface PrivateResult {
  id: string;
  status: 'queued' | 'processing' | 'ready' | 'partial' | 'failed';
  width: number;
  height: number;
  originalBytes: number | null;
  caption: string | null;
  altText: string | null;
  subject: string | null;
  focal: { x: number; y: number } | null;
  focalSource: string;
  analysisModel: string;
  note: string | null;
  preview: string | null;
  crops: CropSet[];
  provenance: RunRecords;
  creative: {
    status: 'idle' | 'queued' | 'processing' | 'ready' | 'failed';
    url: string | null;
    model: string;
  };
}

export interface GalleryExample {
  id: string;
  title: string;
  caption: string;
  altText: string;
  credit: string;
  approvedAt: string;
  preview: string;
  crops: CropSet[];
  creative: string | null;
  provenance: RunRecords | null;
}
