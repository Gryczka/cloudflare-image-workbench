/** The shared inspector. It builds DOM nodes and text from API responses, never HTML strings. */
export interface SourceFile {
  path: string;
  source: string;
}

export interface InspectedImage {
  url: string;
  alt: string;
  label: string;
  dimensions?: string;
  mime?: string;
  bytes?: number | null;
  credit?: string;
  creditUrl?: string;
}

export interface InspectorView {
  id: string;
  source?: InspectedImage;
  output?: InspectedImage;
  resultNote: string;
  context: string;
  flow: readonly string[];
  flowNote: string;
  code: SourceFile[];
  codeNote: string;
  resolved: unknown;
  details: Record<string, string | number | null | undefined>;
}

const TOKENS =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:await|async|const|let|return|if|else|try|catch|for|of|function|export|class|private|new|true|false|null|this|type|interface|case|break|switch)\b|\b\d+(?:\.\d+)?\b/g;

function highlight(code: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  let index = 0;
  for (const match of code.matchAll(TOKENS)) {
    const position = match.index ?? 0;
    if (position > index) fragment.append(document.createTextNode(code.slice(index, position)));
    const span = document.createElement('span');
    span.className =
      /^\/\//.test(match[0]) || /^\/\*/.test(match[0])
        ? 'code-comment'
        : /^["'`]/.test(match[0])
          ? 'code-string'
          : /^\d/.test(match[0])
            ? 'code-number'
            : 'code-keyword';
    span.textContent = match[0];
    fragment.append(span);
    index = position + match[0].length;
  }
  if (index < code.length) fragment.append(document.createTextNode(code.slice(index)));
  return fragment;
}

function text(tag: string, content: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}

function imageCard(image: InspectedImage): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'inspector-image';
  const img = document.createElement('img');
  img.src = image.url;
  img.alt = image.alt;
  img.loading = 'lazy';
  const caption = document.createElement('figcaption');
  caption.append(text('strong', image.label));
  const meta = [
    image.dimensions,
    image.mime,
    image.bytes == null ? null : `${image.bytes.toLocaleString()} B`,
  ]
    .filter(Boolean)
    .join(' · ');
  if (meta) caption.append(text('small', meta));
  if (image.credit && image.creditUrl) {
    const anchor = document.createElement('a');
    anchor.textContent = image.credit;
    anchor.href = image.creditUrl;
    if (anchor.origin !== window.location.origin) {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
    caption.append(anchor);
  }
  figure.append(img, caption);
  return figure;
}

function codePanel(code: SourceFile[]): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'inspector-code-list';
  for (const entry of code) {
    const section = document.createElement('section');
    section.className = 'inspector-code-file';
    const heading = document.createElement('div');
    heading.className = 'inspector-code-heading';
    heading.append(text('strong', entry.path));
    const copy = text('button', 'Copy code', 'inspector-copy') as HTMLButtonElement;
    copy.type = 'button';
    copy.setAttribute('aria-label', `Copy ${entry.path}`);
    const copied = text('span', '', 'sr-only');
    copied.setAttribute('role', 'status');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(entry.source);
        copied.textContent = `${entry.path} copied`;
        copy.textContent = 'Copied ✓';
      } catch {
        copied.textContent = 'Copy unavailable; select the source text to copy it.';
      }
    });
    heading.append(copy, copied);
    const pre = document.createElement('pre');
    const source = document.createElement('code');
    source.append(highlight(entry.source));
    pre.append(source);
    section.append(heading, pre);
    panel.append(section);
  }
  return panel;
}

/** Shared, keyboard-accessible inspector for public recipes, private runs, and approved gallery examples. */
export function showInspector(root: HTMLElement, view: InspectorView): void {
  root.replaceChildren();
  const labels = ['Result', 'Architecture', 'Executed code', 'Run details'] as const;
  const tabs = document.createElement('div');
  tabs.className = 'inspector-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Sample inspector');
  const panels: HTMLElement[] = [];
  const buttons: HTMLButtonElement[] = [];

  for (const [index, label] of labels.entries()) {
    const tab = text('button', label, 'inspector-tab') as HTMLButtonElement;
    tab.id = `${view.id}-tab-${index}`;
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `${view.id}-panel-${index}`);
    const panel = document.createElement('section');
    panel.id = `${view.id}-panel-${index}`;
    panel.className = 'inspector-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    const activate = () => {
      for (const [i, button] of buttons.entries()) {
        button.setAttribute('aria-selected', String(i === index));
        button.tabIndex = i === index ? 0 : -1;
        panels[i].hidden = i !== index;
      }
    };
    tab.addEventListener('click', activate);
    tab.addEventListener('keydown', (event) => {
      const next = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!next) return;
      event.preventDefault();
      const target = buttons[(index + next + buttons.length) % buttons.length];
      target.click();
      target.focus();
    });
    buttons.push(tab);
    panels.push(panel);
    tabs.append(tab);
  }

  const result = document.createElement('div');
  result.className = 'inspector-images';
  if (view.source) result.append(imageCard(view.source));
  if (view.output) result.append(imageCard(view.output));
  panels[0].append(result, text('p', view.resultNote, 'inspector-note'));

  panels[1].append(text('p', view.context, 'inspector-context'));
  const flow = document.createElement('ol');
  flow.className = 'inspector-flow';
  for (const step of view.flow) flow.append(text('li', step));
  panels[1].append(flow, text('p', view.flowNote, 'inspector-note'));

  panels[2].append(text('p', view.codeNote, 'inspector-note'), codePanel(view.code));

  panels[3].append(text('h4', 'Resolved parameters', 'micro-label'));
  const pre = document.createElement('pre');
  const resolved = document.createElement('code');
  resolved.append(highlight(JSON.stringify(view.resolved, null, 2) ?? 'Unavailable'));
  pre.append(resolved);
  panels[3].append(pre);
  const details = document.createElement('dl');
  details.className = 'inspector-details';
  for (const [key, value] of Object.entries(view.details)) {
    details.append(text('dt', key), text('dd', value == null ? 'Unavailable' : String(value)));
  }
  panels[3].append(details);

  root.append(tabs, ...panels);
  buttons[0].click();
}
