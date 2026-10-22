import DOMPurify from 'dompurify';
import { renderSimpleMarkdown } from '@boardcache/text';

/**
 * People-written text (community descriptions, bios and comments, project
 * descriptions) in simple markdown: no images, no raw HTML, http(s) links only. The renderer only ever emits a fixed set of tags from escaped
 * text; DOMPurify runs over the result as well, so the page never trusts a
 * renderer bug either.
 */
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'code',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
];
const ALLOWED_ATTR = ['href'];

export function simpleMarkdownHtml(text: string): string {
  const fragment = DOMPurify.sanitize(renderSimpleMarkdown(text), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^https?:/i,
    RETURN_DOM_FRAGMENT: true,
  });
  // Links open in a new tab and never leak the referrer or an opener (set
  // after sanitising, the same way the note renderer does it).
  fragment.querySelectorAll('a').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noreferrer noopener');
  });
  const holder = document.createElement('div');
  holder.appendChild(fragment);
  return holder.innerHTML;
}

export function SimpleMarkdown({
  text,
  className,
  testId,
}: {
  text: string;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      className={`simple-md${className ? ` ${className}` : ''}`}
      data-testid={testId}
      dangerouslySetInnerHTML={{ __html: simpleMarkdownHtml(text) }}
    />
  );
}
