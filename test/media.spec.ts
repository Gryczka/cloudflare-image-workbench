import { describe, expect, it } from 'vitest';
import { inspectImage, MAX_UPLOAD_BYTES, UploadError } from '../src/lib/media';

const jpegSignature = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0]);
const info = (width: number, height: number) =>
  ({
    info: async () => ({ format: 'image/jpeg', width, height, fileSize: jpegSignature.length }),
  }) as Pick<ImagesBinding, 'info'>;

describe('public upload validation', () => {
  it('accepts an image whose signature, type, and decoded dimensions agree', async () => {
    const file = new File([jpegSignature], 'photo.jpg', { type: 'image/jpeg' });
    expect(await inspectImage(file, info(1200, 800))).toMatchObject({
      mime: 'image/jpeg',
      width: 1200,
      height: 800,
    });
  });

  it('rejects spoofed media, oversized content and oversized dimensions', async () => {
    const spoofed = new File([jpegSignature], 'photo.png', { type: 'image/png' });
    await expect(inspectImage(spoofed, info(1200, 800))).rejects.toMatchObject({ status: 415 });

    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'photo.jpg', {
      type: 'image/jpeg',
    });
    await expect(inspectImage(big, info(1200, 800))).rejects.toMatchObject({ status: 413 });

    const valid = new File([jpegSignature], 'photo.jpg', { type: 'image/jpeg' });
    await expect(inspectImage(valid, info(5000, 4000))).rejects.toThrow(UploadError);
  });
});
