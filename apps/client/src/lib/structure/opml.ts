/**
 * OPML, the subscription list every feed reader exports: nested `outline`
 * elements, a feed where one carries `xmlUrl`, a folder where one holds
 * others. Read into flat feeds with their folder path; written back as the
 * same tree.
 */

interface OpmlFeed {
  url: string;
  /** The feed's name as listed (`text`, else `title`); '' when none. */
  title: string;
  /** The folder path from the enclosing outlines ("News/Tech"); '' = root. */
  folder: string;
  htmlUrl?: string;
}

/** The feeds an OPML document lists, in document order. */
export function parseOpml(text: string): OpmlFeed[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('That is not an OPML file.');
  const root = doc.documentElement;
  const body =
    root.tagName.toLowerCase() === 'opml'
      ? Array.from(root.children).find((c) => c.tagName.toLowerCase() === 'body')
      : undefined;
  if (!body) throw new Error('That is not an OPML file.');
  const out: OpmlFeed[] = [];
  const seen = new Set<string>();
  const walk = (el: Element, path: string[]) => {
    for (const child of Array.from(el.children)) {
      if (child.tagName.toLowerCase() !== 'outline') continue;
      const url = (child.getAttribute('xmlUrl') ?? child.getAttribute('xmlurl') ?? '').trim();
      const label = (child.getAttribute('text') ?? child.getAttribute('title') ?? '').trim();
      if (url) {
        if (!seen.has(url)) {
          seen.add(url);
          const htmlUrl = (child.getAttribute('htmlUrl') ?? '').trim();
          out.push({
            url,
            title: label,
            folder: path.join('/'),
            ...(htmlUrl ? { htmlUrl } : {}),
          });
        }
      } else if (child.children.length) {
        walk(child, label ? [...path, label] : path);
      }
    }
  };
  walk(body, []);
  return out;
}

const attr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Node {
  folders: Map<string, Node>;
  feeds: OpmlFeed[];
}

/** An OPML document of the feeds, folders as nested outlines. */
export function buildOpml(feeds: OpmlFeed[], title = 'Feeds'): string {
  const root: Node = { folders: new Map(), feeds: [] };
  for (const f of feeds) {
    let node = root;
    for (const part of f.folder.split('/').filter(Boolean)) {
      let next = node.folders.get(part);
      if (!next) {
        next = { folders: new Map(), feeds: [] };
        node.folders.set(part, next);
      }
      node = next;
    }
    node.feeds.push(f);
  }
  const lines: string[] = [];
  const write = (node: Node, depth: number) => {
    const pad = '  '.repeat(depth);
    for (const [name, child] of node.folders) {
      lines.push(`${pad}<outline text="${attr(name)}" title="${attr(name)}">`);
      write(child, depth + 1);
      lines.push(`${pad}</outline>`);
    }
    for (const f of node.feeds) {
      const name = attr(f.title || f.url);
      lines.push(
        `${pad}<outline type="rss" text="${name}" title="${name}" xmlUrl="${attr(f.url)}"${
          f.htmlUrl ? ` htmlUrl="${attr(f.htmlUrl)}"` : ''
        }/>`,
      );
    }
  };
  write(root, 2);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${attr(title)}</title>`,
    `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
    '  </head>',
    '  <body>',
    ...lines,
    '  </body>',
    '</opml>',
    '',
  ].join('\n');
}
