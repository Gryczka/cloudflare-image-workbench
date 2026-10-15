/**
 * The image Workflow. An editorial job sanitizes a preview, asks Workers AI for drafts and a focal
 * point, renders every crop, and deletes the original; a creative job generates one synthetic
 * illustration. Each job first claims its D1 row, so a re-delivered or re-run instance stops there.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { analyzeImage, generateCreative, type Analysis, type CreativeStyle } from '../lib/ai';
import {
  CROP_MODES,
  PRESETS,
  editorialCrop,
  privateKey,
  originalKey,
  transformAndStore,
  type CropMode,
} from '../lib/media';
import type { UploadRow } from '../lib/uploads';
import {
  creativeProvenance,
  derivative,
  editorialProvenance,
  snapshot,
  type Derivative,
} from '../showcases/provenance';

type ImageJob =
  { id: string; kind: 'editorial' } | { id: string; kind: 'creative'; style: CreativeStyle };

/** Editorial jobs come from the Queue consumer or upload route; creative jobs from their route. */
export class ProcessImageWorkflow extends WorkflowEntrypoint<Env, ImageJob> {
  async run(event: WorkflowEvent<ImageJob>, step: WorkflowStep) {
    const job = event.payload;
    if (!job || !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/.test(job.id)) return;
    if (job.kind === 'creative') return this.runCreative(job, step);
    if (job.kind !== 'editorial') return;
    return this.runEditorial(job.id, step);
  }

  // showcase:start editorial
  private async runEditorial(id: string, step: WorkflowStep) {
    const claimed = await step.do('claim editorial job', async () => {
      const row = await this.env.DB.prepare(
        `UPDATE uploads SET status = 'processing'
         WHERE id = ? AND status = 'queued' AND expires_at > ? RETURNING id`,
      )
        .bind(id, Date.now())
        .first();
      return row !== null;
    });
    if (!claimed) return;

    try {
      const recordedSource = await step.do('capture editorial recipe source', async () => {
        const [pipeline, editorialAi] = await Promise.all([
          snapshot('pipeline'),
          snapshot('editorial-ai'),
        ]);
        return { pipeline, 'editorial-ai': editorialAi };
      });
      const row = await this.env.DB.prepare('SELECT * FROM uploads WHERE id = ?')
        .bind(id)
        .first<UploadRow>();
      if (!row) throw new Error('Editorial upload is missing.');

      const preview = await step.do('sanitize preview', async () => {
        const transform: ImageTransform = {
          width: 1024,
          height: 1024,
          fit: 'scale-down',
        };
        return derivative(
          'preview',
          transform,
          await transformAndStore(this.env, id, 'preview', transform),
        );
      });
      const analysis: Analysis = await step.do('suggest editorial metadata', () =>
        analyzeImage(this.env, id),
      );
      const available: string[] = [];
      const crops: Derivative[] = [];
      const notes = analysis.note ? [analysis.note] : [];

      for (const preset of PRESETS) {
        for (const mode of CROP_MODES) {
          if (mode === 'ai' && !analysis.focal) continue;
          const name = `${preset.key}-${mode}`;
          try {
            const crop = await step.do(`crop ${name}`, async () => {
              const transform = editorialCrop(preset, mode as CropMode, analysis.focal);
              return derivative(
                name,
                transform,
                await transformAndStore(this.env, id, name, transform),
              );
            });
            available.push(name);
            crops.push(crop);
          } catch (error) {
            if (mode === 'center') throw error;
            notes.push(
              `${mode === 'auto' ? 'Automatic' : 'AI-guided'} ${preset.key} crop unavailable.`,
            );
          }
        }
      }

      const [currentPipeline, currentAi] = await Promise.all([
        snapshot('pipeline'),
        snapshot('editorial-ai'),
      ]);
      if (
        currentPipeline.version !== recordedSource.pipeline.version ||
        currentAi.version !== recordedSource['editorial-ai'].version
      ) {
        throw new Error(
          'Editorial recipe changed during this Workflow run. No result was published.',
        );
      }
      const provenance = editorialProvenance(row, preview, crops, analysis, notes, recordedSource);
      await step.do('publish private editorial results', async () => {
        await this.env.DB.prepare(
          `UPDATE uploads SET status = ?, caption = ?, alt_text = ?, subject = ?,
            focal_x = ?, focal_y = ?, focal_source = ?, outputs_json = ?, error_note = ?, editorial_provenance_json = ?
            WHERE id = ? AND expires_at > ?`,
        )
          .bind(
            provenance.status,
            analysis.caption,
            analysis.altText,
            analysis.subject,
            analysis.focal?.x ?? null,
            analysis.focal?.y ?? null,
            analysis.focalSource,
            JSON.stringify(available),
            notes.join(' ') || null,
            JSON.stringify(provenance),
            id,
            Date.now(),
          )
          .run();
      });
      await step.do('remove private original', () => this.env.MEDIA.delete(originalKey(id)));
    } catch (error) {
      await step.do('mark editorial failure', async () => {
        await this.env.DB.prepare(
          `UPDATE uploads SET status = 'failed', error_note = 'Processing could not be completed.' WHERE id = ?`,
        )
          .bind(id)
          .run();
        console.error(JSON.stringify({ event: 'editorial_workflow_failed' }));
      });
      throw error;
    }
  }
  // showcase:end editorial

  // showcase:start creative
  private async runCreative(job: Extract<ImageJob, { kind: 'creative' }>, step: WorkflowStep) {
    const claimed = await step.do('claim creative job', async () => {
      const row = await this.env.DB.prepare(
        `UPDATE uploads SET creative_status = 'processing'
         WHERE id = ? AND creative_status = 'queued' AND creative_prompt = ?
           AND status IN ('ready', 'partial') AND expires_at > ? RETURNING id`,
      )
        .bind(job.id, job.style, Date.now())
        .first();
      return row !== null;
    });
    if (!claimed) return;

    try {
      const recordedSource = await step.do('capture synthetic recipe source', () =>
        snapshot('synthetic'),
      );
      const row = await this.env.DB.prepare('SELECT * FROM uploads WHERE id = ?')
        .bind(job.id)
        .first<UploadRow>();
      if (!row) throw new Error('Creative upload is missing.');

      // Inference is billable and not idempotent. Do not automatically repeat it after encoding fails.
      const processing = await step.do(
        'generate distinct synthetic image',
        { retries: { limit: 0, delay: '30 seconds', backoff: 'constant' } },
        () => generateCreative(this.env, job.id, job.style),
      );
      if ((await snapshot('synthetic')).version !== recordedSource.version) {
        throw new Error(
          'Synthetic recipe changed during this Workflow run. No result was published.',
        );
      }
      const provenance = creativeProvenance(row, processing, recordedSource);
      await step.do('publish private creative result', async () => {
        await this.env.DB.prepare(
          `UPDATE uploads SET creative_status = 'ready', creative_key = ?, creative_provenance_json = ?
           WHERE id = ? AND expires_at > ?`,
        )
          .bind(privateKey(job.id, 'creative'), JSON.stringify(provenance), job.id, Date.now())
          .run();
      });
    } catch (error) {
      await step.do('mark creative failure', async () => {
        await this.env.DB.prepare(`UPDATE uploads SET creative_status = 'failed' WHERE id = ?`)
          .bind(job.id)
          .run();
        console.error(JSON.stringify({ event: 'creative_workflow_failed' }));
      });
      throw error;
    }
  }
  // showcase:end creative
}
