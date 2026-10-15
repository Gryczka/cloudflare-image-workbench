/** Public links on the prerendered page. Point these at your fork if you deploy your own copy. */
export const REPOSITORY_URL = 'https://github.com/Gryczka/cloudflare-image-workbench';
export const REMOVAL_REQUEST_URL = `${REPOSITORY_URL}/issues/new?template=removal_request.md`;

/** The hosted demo is listed in the Unrefined App Garden; set these to null in a fork. */
export const GARDEN_URL: string | null = 'https://gryczka.dev/garden/';
const DOCS_ATTRIBUTION: { source: string; campaign: string; project: string } | null = {
  source: 'gryczka.dev',
  campaign: 'app-garden',
  project: 'cloudflare-image-workbench',
};

/** Adds App Garden referral parameters to Cloudflare links; other links pass through unchanged. */
export function docsLink(href: string): string {
  const url = new URL(href);
  if (
    !DOCS_ATTRIBUTION ||
    url.protocol !== 'https:' ||
    !/(^|\.)cloudflare\.com$/.test(url.hostname)
  ) {
    return href;
  }
  const path = url.pathname.split('/').filter(Boolean);
  url.searchParams.set('utm_source', DOCS_ATTRIBUTION.source);
  url.searchParams.set('utm_medium', 'referral');
  url.searchParams.set('utm_campaign', DOCS_ATTRIBUTION.campaign);
  url.searchParams.set(
    'utm_content',
    `${DOCS_ATTRIBUTION.project}-${path.join('-') || 'overview'}`,
  );
  url.searchParams.set('utm_term', path[0] ?? 'cloudflare');
  return url.href;
}
