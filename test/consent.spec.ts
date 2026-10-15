import { describe, expect, it } from 'vitest';
import { uploadConsent } from '../src/lib/consent';

describe('explicit gallery permission', () => {
  it('never interprets a credit alone as permission', () => {
    const form = new FormData();
    form.set('gallery-credit', 'My credit');
    expect(uploadConsent(form, 123)).toEqual({ consentAt: null, consentCredit: null });
  });
  it('records permission with the supplied credit', () => {
    const form = new FormData();
    form.set('gallery-consent', 'yes');
    form.set('gallery-credit', ' My credit ');
    expect(uploadConsent(form, 123)).toEqual({ consentAt: 123, consentCredit: 'My credit' });
  });
  it.each(['', ' '.repeat(5), 'a'.repeat(121)])('rejects unusable credit %s', (credit) => {
    const form = new FormData();
    form.set('gallery-consent', 'yes');
    form.set('gallery-credit', credit);
    expect(() => uploadConsent(form, 123)).toThrow();
  });
  it('rejects ambiguous or malformed permission fields', () => {
    const form = new FormData();
    form.append('gallery-consent', 'yes');
    form.append('gallery-consent', 'no');
    expect(() => uploadConsent(form, 123)).toThrow();
  });
});
