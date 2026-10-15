/** Private upload records in D1: creation, capability-checked lookup, and the owner's view. */
import { CROP_MODES, PRESETS, PRIVATE_LIFETIME_MS, originalKey } from './media';
import { bearerToken, sha256 } from './security';
import {
  parseProvenance,
  type CreativeProvenance,
  type EditorialProvenance,
} from '../showcases/provenance';

/** A row of the `uploads` table; `capability_hash` is the SHA-256 of the owner's bearer token. */
export interface UploadRow {
  id: string;
  capability_hash: string;
  original_key: string;
  original_sha256: string | null;
  original_bytes: number | null;
  mime_type: string;
  width: number;
  height: number;
  created_at: number;
  expires_at: number;
  status: 'queued' | 'processing' | 'ready' | 'partial' | 'failed';
  caption: string | null;
  alt_text: string | null;
  subject: string | null;
  focal_x: number | null;
  focal_y: number | null;
  focal_source: string;
  outputs_json: string;
  error_note: string | null;
  creative_status: 'idle' | 'queued' | 'processing' | 'ready' | 'failed';
  creative_key: string | null;
  creative_prompt: string | null;
  editorial_provenance_json: string | null;
  creative_provenance_json: string | null;
  gallery_consent_at: number | null;
  consent_credit: string | null;
}

/** Insert a queued upload that expires after `PRIVATE_LIFETIME_MS`, with any gallery consent. */
export async function createUploadRecord(
  db: D1Database,
  data: {
    id: string;
    hash: string;
    mime: string;
    width: number;
    height: number;
    now: number;
    sourceHash?: string;
    sourceBytes?: number;
    consentAt?: number | null;
    consentCredit?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO uploads (id, capability_hash, original_key, mime_type, width, height, created_at, expires_at, original_sha256, original_bytes, gallery_consent_at, consent_credit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.id,
      data.hash,
      originalKey(data.id),
      data.mime,
      data.width,
      data.height,
      data.now,
      data.now + PRIVATE_LIFETIME_MS,
      data.sourceHash ?? null,
      data.sourceBytes ?? null,
      data.consentAt ?? null,
      data.consentCredit ?? null,
    )
    .run();
}

/** Missing, invalid and expired capabilities all produce the same not-found outcome. */
export async function authorizedUpload(
  db: D1Database,
  request: Request,
  id: string,
  now = Date.now(),
): Promise<UploadRow | null> {
  const token = bearerToken(request);
  if (!token || !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/.test(id)) return null;
  return db
    .prepare('SELECT * FROM uploads WHERE id = ? AND capability_hash = ? AND expires_at > ?')
    .bind(id, await sha256(token), now)
    .first<UploadRow>();
}

/** The owner's view of a result: links only to assets that exist, plus recorded provenance. */
export function uploadView(row: UploadRow) {
  const ready = row.status === 'ready' || row.status === 'partial';
  const available: string[] = ready ? JSON.parse(row.outputs_json) : [];
  const editorial = parseProvenance<EditorialProvenance>(row.editorial_provenance_json);
  const creative = parseProvenance<CreativeProvenance>(row.creative_provenance_json);
  return {
    id: row.id,
    status: row.status,
    width: row.width,
    height: row.height,
    originalBytes: row.original_bytes,
    expiresAt: new Date(row.expires_at).toISOString(),
    caption: row.caption,
    altText: row.alt_text,
    subject: row.subject,
    focal: row.focal_x !== null && row.focal_y !== null ? { x: row.focal_x, y: row.focal_y } : null,
    focalSource: row.focal_source,
    note: row.error_note,
    preview: ready ? `/api/uploads/${row.id}/assets/preview` : null,
    crops: ready
      ? PRESETS.map((preset) => ({
          ...preset,
          modes: CROP_MODES.map((mode) => ({
            mode,
            url: available.includes(`${preset.key}-${mode}`)
              ? `/api/uploads/${row.id}/assets/${preset.key}-${mode}`
              : null,
          })),
        }))
      : [],
    creative: {
      status: row.creative_status,
      prompt: row.creative_prompt,
      url: row.creative_status === 'ready' ? `/api/uploads/${row.id}/assets/creative` : null,
      model:
        creative?.model ??
        (row.creative_status === 'ready' ? 'Historical model unavailable' : 'Not yet generated'),
    },
    analysisModel: editorial?.analysis.writingModel ?? 'Historical model attribution unavailable',
    provenance: { editorial, creative },
  };
}
