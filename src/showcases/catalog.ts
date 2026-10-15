/** A deliberately small, versioned set of public sources. Private uploads are never addressable here. */
export const DEMO_SOURCES = [
  {
    id: 'colmar',
    title: 'A street in Colmar',
    asset: '/showcase-colmar-0b2bac0a.jpg',
    sha256: '0b2bac0a28e4c95722c6b64a36b5640e31e6ca74f1a4d09930a3e16e7e7269bb',
    bytes: 359419,
    width: 1280,
    height: 853,
    alt: 'Colorful storefronts on a narrow street in Colmar',
    credit: 'DimiTalen · CC0 1.0 / Wikimedia Commons',
    creditUrl:
      'https://commons.wikimedia.org/wiki/File:Colorful_fa%C3%A7ades,_Rue_de_la_Poissonnerie,_Colmar,_2026.jpg',
  },
  {
    id: 'portrait',
    title: 'Portrait in a garden',
    asset: '/showcase-portrait-9112a7da.jpeg',
    sha256: '9112a7da5689a2334c9d258d4192657d713aa80f2c176200d9b4ff058ee068d9',
    bytes: 450282,
    width: 1200,
    height: 1800,
    alt: 'Woman in a dark cardigan beside flowers',
    credit: 'Suad Kamardeen · Unsplash License; resized from Cloudflare Images documentation',
    creditUrl:
      'https://unsplash.com/photos/woman-in-black-cardigan-standing-beside-pink-flowers-UO-82DJ3rcc',
  },
  {
    id: 'product',
    title: 'Studio product illustration',
    asset: '/showcase-product-34db3f72.jpg',
    sha256: '34db3f7229f76ec227a2744ac0261c77cc3b74ecba80e9e95bda9173b6131c7b',
    bytes: 96493,
    width: 1600,
    height: 1067,
    alt: 'Original illustration of a camera placed to the right of a studio backdrop',
    credit: 'Original illustration · Image Workbench',
    creditUrl: '/showcase-product.svg',
  },
] as const;

/** Overlay assets; each name carries a SHA-256 prefix that the build verifies. */
export const WATERMARK_ASSET = '/showcase-watermark-79dd7a51.png';
export const FONT_ASSET = '/showcase-dm-sans-35c5efa0.woff2';

/** The nine sample families, each with its category, allowed variants, docs link, and data flow. */
export const SHOWCASES = [
  {
    id: 'resize',
    kind: 'request',
    category: 'Image transformations',
    title: 'Resize, fit & crop',
    summary:
      'Compare a square crop, a letterboxed image, and an enlargement with or without upscaling.',
    docsUrl: 'https://developers.cloudflare.com/images/optimization/features/#fit',
    defaultSource: 'product',
    variants: [
      { id: 'cover', label: 'Cover · 720 × 720' },
      { id: 'contain', label: 'Contain · within 720 × 720' },
      { id: 'pad', label: 'Pad · 720 × 720' },
      { id: 'enlarge', label: 'Cover · enlarge to 1800 × 1800' },
      { id: 'crop', label: 'Crop · 1800 × 1800, never enlarge' },
    ],
    flow: [
      'Browser recipe URL',
      'HTTP Worker policy',
      'ASSETS · public original',
      'IMAGES · transform',
      'Workers Cache · image',
    ],
  },
  {
    id: 'framing',
    kind: 'request',
    category: 'Image transformations',
    title: 'Smart & focal framing',
    summary:
      'Compare a center crop, saliency, face gravity, and a point that you select on the source.',
    docsUrl: 'https://developers.cloudflare.com/images/optimization/features/#gravity--g',
    defaultSource: 'portrait',
    variants: [
      { id: 'center', label: 'Center' },
      { id: 'saliency', label: 'Automatic saliency' },
      { id: 'face', label: 'Detected face' },
      { id: 'point', label: 'Select a focal point' },
    ],
    flow: [
      'Browser + bounded point',
      'HTTP Worker validation',
      'ASSETS · public original',
      'IMAGES · fit + gravity',
      'Workers Cache · image',
    ],
  },
  {
    id: 'format',
    kind: 'request',
    category: 'Image transformations',
    title: 'Format & quality',
    summary: 'Compare JPEG, WebP, and AVIF with fixed and perceptual quality settings.',
    docsUrl: 'https://developers.cloudflare.com/images/optimization/binding/#outputoptions',
    defaultSource: 'colmar',
    variants: [
      { id: 'jpeg', label: 'JPEG · 85' },
      { id: 'webp', label: 'WebP · 82' },
      { id: 'webp-small', label: 'WebP · 55' },
      { id: 'webp-perceptual', label: 'WebP · perceptual via fetch' },
      { id: 'avif', label: 'AVIF · 60' },
    ],
    flow: [
      'Browser recipe URL',
      'HTTP Worker policy',
      'ASSETS · public original',
      'IMAGES · output encoding',
      'Workers Cache · image',
    ],
  },
  {
    id: 'effects',
    kind: 'request',
    category: 'Image transformations',
    title: 'Effects & order',
    summary: 'Apply visible adjustments; change the order of chained operations on the same image.',
    docsUrl: 'https://developers.cloudflare.com/images/optimization/binding/#transformoptions',
    defaultSource: 'colmar',
    variants: [
      { id: 'grayscale', label: 'Grayscale + contrast' },
      { id: 'sharpen', label: 'Downscale + sharpen' },
      { id: 'blur-first', label: 'Blur → resize' },
      { id: 'resize-first', label: 'Resize → blur' },
      { id: 'rotate', label: 'Rotate + flip' },
    ],
    flow: [
      'Browser recipe URL',
      'HTTP Worker ordered policy',
      'ASSETS · public original',
      'IMAGES · chained transforms',
      'Workers Cache · image',
    ],
  },
  {
    id: 'composition',
    kind: 'request',
    category: 'Image transformations',
    title: 'Watermarks & text',
    summary: 'Draw a real graphic overlay or rasterized type before or after resizing.',
    docsUrl: 'https://developers.cloudflare.com/images/optimization/draw-overlays/',
    defaultSource: 'product',
    variants: [
      { id: 'logo-after', label: 'Resize → logo' },
      { id: 'logo-before', label: 'Logo → resize' },
      { id: 'text', label: 'Text overlay' },
    ],
    flow: [
      'Browser recipe URL',
      'HTTP Worker',
      'ASSETS · original + logo/font',
      'IMAGES · transform + draw',
      'Workers Cache · image',
    ],
  },
  {
    id: 'responsive',
    kind: 'request',
    category: 'Delivery and orchestration',
    title: 'Adaptive delivery',
    summary:
      'Select a breakpoint and send real Accept/Save-Data headers to a versioned Worker URL.',
    docsUrl: 'https://developers.cloudflare.com/workers/cache/',
    defaultSource: 'colmar',
    variants: [
      { id: '320', label: 'Small · 320 px' },
      { id: '640', label: 'Medium · 640 px' },
      { id: '960', label: 'Large · 960 px' },
    ],
    flow: [
      'Browser Accept + Save-Data',
      'HTTP Worker negotiation',
      'ASSETS · public original',
      'IMAGES · chosen encoding',
      'Workers Cache · Vary',
    ],
  },
  {
    id: 'pipeline',
    kind: 'workflow',
    category: 'Delivery and orchestration',
    title: 'Private originals, durable derivatives',
    summary: 'Contrast a request-time recipe with an upload-time pipeline that persists each crop.',
    docsUrl: 'https://developers.cloudflare.com/images/optimization/binding/',
    defaultSource: 'colmar',
    variants: [{ id: 'editorial', label: '9 durable editorial crops' }],
    flow: [
      'POST · HTTP Worker',
      'MEDIA · private original',
      'R2 notification → Queue',
      'PROCESS_IMAGE · Workflow + IMAGES',
      'MEDIA · private WebP results',
    ],
  },
  {
    id: 'editorial-ai',
    kind: 'workflow',
    category: 'AI-assisted workflows',
    title: 'AI editorial assistance',
    summary:
      'A vision model suggests text and an editable focal point before Images makes the crop.',
    docsUrl: 'https://developers.cloudflare.com/workers-ai/',
    defaultSource: 'portrait',
    variants: [{ id: 'focal', label: 'Focal suggestion + crop' }],
    flow: [
      'MEDIA · sanitized preview',
      'PROCESS_IMAGE · Workflow',
      'AI · vision / identified fallback',
      'IMAGES · focal crop',
      'MEDIA · private derivative',
    ],
  },
  {
    id: 'synthetic',
    kind: 'workflow',
    category: 'AI-assisted workflows',
    title: 'Clearly synthetic illustration',
    summary: 'The optional generation path is separate from editorial transformations.',
    docsUrl: 'https://developers.cloudflare.com/workers-ai/',
    defaultSource: 'product',
    variants: [{ id: 'creative', label: 'Illustration / separate lane' }],
    flow: [
      'MEDIA · private original',
      'IMAGES · bounded model input',
      'AI · FLUX.2 generation',
      'IMAGES · sanitize output',
      'MEDIA · synthetic WebP',
    ],
  },
] as const;

export type DemoSource = (typeof DEMO_SOURCES)[number];
export type Showcase = (typeof SHOWCASES)[number];
export type RequestShowcase = Extract<Showcase, { kind: 'request' }>;

export function demoSource(id: string): DemoSource | undefined {
  return DEMO_SOURCES.find((item) => item.id === id);
}

export function showcase(id: string): Showcase | undefined {
  return SHOWCASES.find((item) => item.id === id);
}

export function showcaseVariant(item: Showcase, id: string): boolean {
  return item.variants.some((variant) => variant.id === id);
}
