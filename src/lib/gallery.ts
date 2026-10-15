/** Operator approval into the public gallery, and the public view of approved examples. */
import { CROP_MODES, PRESETS, galleryKey, privateKey } from './media';
import type { UploadRow } from './uploads';
import {
  parseProvenance,
  publicProvenance,
  type CreativeProvenance,
  type EditorialProvenance,
} from '../showcases/provenance';

/** A review failure with the HTTP status the operator route should return. */
export class ReviewError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface GalleryRow {
  id: string;
  upload_id: string;
  title: string;
  caption: string;
  alt_text: string;
  credit: string;
  approved_at: number;
  outputs_json: string;
  has_creative: number;
  provenance_json: string | null;
}

/** Public JSON for one approved example, linking only to assets that were copied. */
export function galleryView(row: GalleryRow) {
  const available: string[] = JSON.parse(row.outputs_json);
  const provenance: {
    editorial: EditorialProvenance | null;
    creative: CreativeProvenance | null;
  } | null = row.provenance_json ? JSON.parse(row.provenance_json) : null;
  return {
    id: row.id,
    title: row.title,
    caption: row.caption,
    altText: row.alt_text,
    credit: row.credit,
    approvedAt: new Date(row.approved_at).toISOString(),
    preview: `/api/gallery/assets/${row.id}/preview`,
    crops: PRESETS.map((preset) => ({
      ...preset,
      modes: CROP_MODES.map((mode) => ({
        mode,
        url: available.includes(`${preset.key}-${mode}`)
          ? `/api/gallery/assets/${row.id}/${preset.key}-${mode}`
          : null,
      })),
    })),
    creative: row.has_creative ? `/api/gallery/assets/${row.id}/creative` : null,
    provenance,
  };
}

/**
 * Publish a consented, unexpired upload. The credit must match the uploader's exactly, and the
 * operator supplies the caption and alt text. Sanitized WebP assets are copied under a new random
 * gallery ID; if any copy fails, the copies and the unpublished row are removed.
 */
export async function approveGallery(
  env: Pick<Env, 'DB' | 'MEDIA'>,
  input: {
    id: string;
    title: string;
    credit: string;
    caption?: string;
    altText?: string;
    includeCreative: boolean;
  },
  now = Date.now(),
): Promise<GalleryRow> {
  const row = await env.DB.prepare(
    `SELECT * FROM uploads WHERE id = ? AND expires_at > ? AND status IN ('ready', 'partial')`,
  )
    .bind(input.id, now)
    .first<UploadRow>();
  if (!row) throw new ReviewError('The private upload is not ready or has expired.', 404);
  if (row.gallery_consent_at === null || !row.consent_credit) {
    throw new ReviewError('The uploader has not opted into the public gallery.', 403);
  }
  if (input.includeCreative && row.creative_status !== 'ready') {
    throw new ReviewError('The synthetic variant is not ready.', 409);
  }

  const title = input.title?.trim().slice(0, 90);
  const credit = input.credit?.trim().slice(0, 120);
  const caption = input.caption?.trim().slice(0, 240);
  const alt = input.altText?.trim().slice(0, 220);
  if (!title || !credit || !caption || !alt) {
    throw new ReviewError('A title, image credit, caption, and alt text are required.');
  }
  if (credit !== row.consent_credit) {
    throw new ReviewError('Use the image credit supplied by the uploader.');
  }

  const outputs: string[] = JSON.parse(row.outputs_json);
  if (!outputs.length) throw new ReviewError('No editorial crops are available.', 409);
  const assets = ['preview', ...outputs, ...(input.includeCreative ? ['creative'] : [])];
  const editorial = parseProvenance<EditorialProvenance>(row.editorial_provenance_json);
  const creative = input.includeCreative
    ? parseProvenance<CreativeProvenance>(row.creative_provenance_json)
    : null;
  const galleryId = crypto.randomUUID();
  const provenance =
    editorial || creative ? JSON.stringify(publicProvenance(galleryId, editorial, creative)) : null;

  try {
    await env.DB.prepare(
      `INSERT INTO gallery
        (id, upload_id, title, caption, alt_text, credit, approved_at, outputs_json, has_creative, provenance_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        galleryId,
        row.id,
        title,
        caption,
        alt,
        credit,
        now,
        JSON.stringify(outputs),
        input.includeCreative ? 1 : 0,
        provenance,
      )
      .run();
  } catch {
    throw new ReviewError('This upload has already been submitted for gallery review.', 409);
  }

  const copied: string[] = [];
  try {
    for (const asset of assets) {
      const source = await env.MEDIA.get(privateKey(row.id, asset));
      if (!source?.body) throw new ReviewError(`Missing sanitized asset: ${asset}`, 409);
      const target = galleryKey(galleryId, asset);
      await env.MEDIA.put(target, source.body, {
        httpMetadata: { contentType: 'image/webp' },
      });
      copied.push(target);
    }
    await env.DB.prepare('UPDATE gallery SET published = 1 WHERE id = ? AND published = 0')
      .bind(galleryId)
      .run();
  } catch (error) {
    if (copied.length) await env.MEDIA.delete(copied);
    await env.DB.prepare('DELETE FROM gallery WHERE id = ? AND published = 0')
      .bind(galleryId)
      .run();
    throw error;
  }

  return {
    id: galleryId,
    upload_id: row.id,
    title,
    caption,
    alt_text: alt,
    credit,
    approved_at: now,
    outputs_json: JSON.stringify(outputs),
    has_creative: input.includeCreative ? 1 : 0,
    provenance_json: provenance,
  };
}
