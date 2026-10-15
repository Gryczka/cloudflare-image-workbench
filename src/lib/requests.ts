import { UploadError } from './media';

/** Bound the request stream before multipart or JSON parsing allocates memory. */
async function readBody(request: Request, limit: number): Promise<Uint8Array> {
  if (!request.body) throw new UploadError('A request body is required.', 400);
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    throw new UploadError('The request is too large.', 413);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new UploadError('The request is too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Parse a multipart form once its raw stream fits within `limit` bytes. */
export async function boundedFormData(request: Request, limit: number): Promise<FormData> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data;')) {
    throw new UploadError('Send a multipart form.', 415);
  }
  const bytes = await readBody(request, limit);
  try {
    return await new Response(new Blob([bytes.buffer as ArrayBuffer]), {
      headers: { 'content-type': contentType },
    }).formData();
  } catch {
    throw new UploadError('The upload form is invalid.', 400);
  }
}

/** Parse a small JSON body once its raw stream fits within `limit` bytes (4 KB by default). */
export async function boundedJson(request: Request, limit = 4096): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    throw new UploadError('Send a JSON request.', 415);
  }
  try {
    return JSON.parse(new TextDecoder().decode(await readBody(request, limit)));
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError('The JSON request is invalid.', 400);
  }
}
