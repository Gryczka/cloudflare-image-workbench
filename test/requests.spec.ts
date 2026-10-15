import { describe, expect, it } from 'vitest';
import { UploadError } from '../src/lib/media';
import { boundedFormData, boundedJson } from '../src/lib/requests';

/** A chunked body: no Content-Length, so only the streaming bound can stop it. */
function streamed(chunks: number, size: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent++ === chunks) return controller.close();
      controller.enqueue(new Uint8Array(size).fill(0x20));
    },
  });
}

function request(body: BodyInit, contentType: string, length?: number) {
  return new Request('https://example.com/api', {
    method: 'POST',
    body,
    headers: {
      'content-type': contentType,
      ...(length ? { 'content-length': String(length) } : {}),
    },
  });
}

async function rejection(promise: Promise<unknown>): Promise<number> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(UploadError);
  return (error as UploadError).status;
}

describe('bounded request bodies', () => {
  it('stops a chunked body without Content-Length at the byte limit', async () => {
    const body = request(streamed(8, 1024), 'application/json');
    expect(body.headers.get('content-length')).toBeNull();
    expect(await rejection(boundedJson(body, 4096))).toBe(413);

    const form = request(streamed(8, 1024), 'multipart/form-data; boundary=x');
    expect(await rejection(boundedFormData(form, 4096))).toBe(413);
  });

  it('rejects an oversized declared length and the wrong content type before parsing', async () => {
    expect(await rejection(boundedJson(request('{}', 'application/json', 999_999), 4096))).toBe(
      413,
    );
    expect(await rejection(boundedJson(request('{}', 'text/plain')))).toBe(415);
    expect(await rejection(boundedFormData(request('{}', 'application/json'), 4096))).toBe(415);
  });

  it('distinguishes malformed input from accepted input', async () => {
    expect(await rejection(boundedJson(request('{', 'application/json')))).toBe(400);
    expect(await boundedJson(request('{"style":"collage"}', 'application/json'))).toEqual({
      style: 'collage',
    });
  });
});
