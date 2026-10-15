/** Run records stored with each derivative, and the reduced public copy for gallery examples. */
import { galleryKey, EDITORIAL_OUTPUT, type StoredAsset } from '../lib/media';
import { sha256 } from '../lib/security';
import type { UploadRow } from '../lib/uploads';
import type { Analysis, CreativeProcessing } from '../lib/ai';
import { workflowCode, type SourceFile } from './code';

export interface SourceIdentity {
  /** Only included in an authorized private upload response. */
  objectKey: string | null;
  sha256: string | null;
  bytes: number | null;
  mime: string;
  width: number;
  height: number;
}

export interface SourceSnapshot {
  version: string;
  code: SourceFile[];
}

export interface Derivative {
  asset: string;
  objectKey: string;
  sourceKey: string | null;
  /** Withheld (null) in public gallery records. */
  sourceBytes: number | null;
  outputBytes: number;
  transform: ImageTransform;
  output: typeof EDITORIAL_OUTPUT;
  transformMs: number;
  storedAt: string;
}

export interface EditorialProvenance {
  kind: 'editorial';
  source: SourceIdentity;
  snapshots: { pipeline: SourceSnapshot; 'editorial-ai': SourceSnapshot };
  startedAt: string;
  finishedAt: string;
  status: 'ready' | 'partial';
  stepsCompleted: string[];
  preview: Derivative;
  crops: Derivative[];
  analysis: Pick<Analysis, 'focal' | 'focalSource' | 'writingModel' | 'focalModel'>;
}

export interface CreativeProvenance {
  kind: 'creative';
  source: SourceIdentity;
  snapshot: SourceSnapshot;
  finishedAt: string;
  stepsCompleted: string[];
  model: string;
  style: string;
  prompt: string;
  /** Absent on older records; never inferred from the current generation policy. */
  generation?: CreativeProcessing['generation'];
  reference: Derivative;
  output: Derivative;
  inferenceMs?: number;
  generationMs: number;
}

function sourceIdentity(row: UploadRow): SourceIdentity {
  return {
    objectKey: row.original_key,
    sha256: row.original_sha256,
    bytes: row.original_bytes,
    mime: row.mime_type,
    width: row.width,
    height: row.height,
  };
}

/** Record one stored derivative: its transform, output settings, sizes, and timing. */
export function derivative(
  asset: string,
  transform: ImageTransform,
  stored: StoredAsset,
): Derivative {
  return {
    asset,
    sourceKey: stored.sourceKey,
    objectKey: stored.objectKey,
    sourceBytes: stored.sourceBytes,
    outputBytes: stored.outputBytes,
    transform,
    output: EDITORIAL_OUTPUT,
    transformMs: stored.transformMs,
    storedAt: stored.storedAt,
  };
}

/** The Workflow source as displayed, plus a short digest, captured when a job runs. */
export async function snapshot(
  family: 'pipeline' | 'editorial-ai' | 'synthetic',
): Promise<SourceSnapshot> {
  const code = workflowCode(family);
  return { version: (await sha256(JSON.stringify(code))).slice(0, 16), code };
}

/** The editorial run record: source identity, snapshots, preview, crops, and model attribution. */
export function editorialProvenance(
  row: UploadRow,
  preview: Derivative,
  crops: Derivative[],
  analysis: Analysis,
  notes: string[],
  snapshots: EditorialProvenance['snapshots'],
): EditorialProvenance {
  return {
    kind: 'editorial',
    source: sourceIdentity(row),
    snapshots,
    startedAt: new Date(row.created_at).toISOString(),
    finishedAt: new Date().toISOString(),
    status: notes.length ? 'partial' : 'ready',
    stepsCompleted: [
      'sanitize preview',
      'suggest editorial metadata',
      ...crops.map((crop) => `crop ${crop.asset}`),
    ],
    preview,
    crops,
    analysis: {
      focal: analysis.focal,
      focalSource: analysis.focalSource,
      writingModel: analysis.writingModel,
      focalModel: analysis.focalModel,
    },
  };
}

export function creativeProvenance(
  row: UploadRow,
  processing: CreativeProcessing,
  recordedSource: SourceSnapshot,
): CreativeProvenance {
  return {
    kind: 'creative',
    source: sourceIdentity(row),
    snapshot: recordedSource,
    finishedAt: new Date().toISOString(),
    stepsCompleted: ['generate distinct synthetic image'],
    model: processing.model,
    style: processing.style,
    prompt: processing.prompt,
    generation: processing.generation,
    reference: derivative(
      'creative-reference',
      processing.referenceTransform,
      processing.reference,
    ),
    output: derivative('creative', processing.outputTransform, processing.output),
    inferenceMs: processing.inferenceMs,
    generationMs: processing.generationMs,
  };
}

export function parseProvenance<T extends EditorialProvenance | CreativeProvenance>(
  value: string | null,
): T | null {
  if (!value) return null;
  try {
    const decoded: unknown = JSON.parse(value);
    if (!decoded || typeof decoded !== 'object' || !('kind' in decoded) || !('source' in decoded))
      return null;
    return decoded as T;
  } catch {
    return null;
  }
}

/**
 * A curator approves derivatives, not disclosure of the private original or transient R2 keys.
 * Exact source bytes and times could confirm a candidate file, so only the day is published.
 */
export function publicProvenance(
  id: string,
  editorial: EditorialProvenance | null,
  creative: CreativeProvenance | null,
): { editorial: EditorialProvenance | null; creative: CreativeProvenance | null } {
  const day = (timestamp: string) => timestamp.slice(0, 10);
  const source = (privateSource: SourceIdentity): SourceIdentity => ({
    ...privateSource,
    objectKey: null,
    sha256: null,
    bytes: null,
  });
  const withheld = (entry: Derivative): Derivative => ({
    ...entry,
    sourceKey: null,
    sourceBytes: null,
    storedAt: day(entry.storedAt),
  });
  const output = (entry: Derivative, asset: string): Derivative => ({
    ...withheld(entry),
    objectKey: galleryKey(id, asset),
  });
  return {
    editorial: editorial
      ? {
          ...editorial,
          source: source(editorial.source),
          startedAt: day(editorial.startedAt),
          finishedAt: day(editorial.finishedAt),
          preview: output(editorial.preview, 'preview'),
          crops: editorial.crops.map((crop) => output(crop, crop.asset)),
        }
      : null,
    creative: creative
      ? {
          ...creative,
          source: source(creative.source),
          finishedAt: day(creative.finishedAt),
          reference: {
            ...withheld(creative.reference),
            // The reference was temporary and was never published to gallery R2.
            objectKey: 'temporary creative reference (deleted)',
          },
          output: output(creative.output, 'creative'),
        }
      : null,
  };
}
