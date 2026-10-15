import { UploadError } from './media';

/** Consent is optional, explicit, and tied to the credit the uploader supplies. */
export function uploadConsent(form: FormData, now: number) {
  const selections = form.getAll('gallery-consent');
  if (!selections.length) return { consentAt: null, consentCredit: null };
  if (selections.length !== 1 || selections[0] !== 'yes') {
    throw new UploadError('Invalid gallery permission.', 400);
  }
  const credits = form.getAll('gallery-credit');
  const credit = credits[0];
  if (credits.length !== 1 || typeof credit !== 'string' || !credit.trim() || credit.length > 120) {
    throw new UploadError(
      'Provide an image credit (up to 120 characters) to opt into the gallery.',
      400,
    );
  }
  return { consentAt: now, consentCredit: credit.trim() };
}
