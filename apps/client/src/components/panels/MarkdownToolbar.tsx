import type { ReactNode } from 'react';
import { applyActiveFormat } from '../../lib/text/mdEditorRegistry';
import {
  bold,
  bulletList,
  codeBlock,
  heading,
  inlineCode,
  italic,
  link,
  numberedList,
  quote,
  strikethrough,
  taskList,
  type EditAction,
} from '../../lib/text/mdFormat';
import {
  BoldIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  SquareCodeIcon,
  StrikethroughIcon,
  TextQuoteIcon,
} from '../icons';

interface Btn {
  id: string;
  icon: ReactNode;
  title: string;
  action: EditAction;
}

const SIZE = 15;

const BUTTONS: Btn[] = [
  { id: 'bold', icon: <BoldIcon size={SIZE} />, title: 'Bold', action: bold },
  { id: 'italic', icon: <ItalicIcon size={SIZE} />, title: 'Italic', action: italic },
  {
    id: 'strike',
    icon: <StrikethroughIcon size={SIZE} />,
    title: 'Strikethrough',
    action: strikethrough,
  },
  { id: 'h1', icon: <Heading1Icon size={SIZE} />, title: 'Heading 1', action: heading(1) },
  { id: 'h2', icon: <Heading2Icon size={SIZE} />, title: 'Heading 2', action: heading(2) },
  { id: 'h3', icon: <Heading3Icon size={SIZE} />, title: 'Heading 3', action: heading(3) },
  { id: 'ul', icon: <ListIcon size={SIZE} />, title: 'Bullet list', action: bulletList },
  { id: 'task', icon: <ListChecksIcon size={SIZE} />, title: 'Checklist', action: taskList },
  { id: 'ol', icon: <ListOrderedIcon size={SIZE} />, title: 'Numbered list', action: numberedList },
  { id: 'quote', icon: <TextQuoteIcon size={SIZE} />, title: 'Quote', action: quote },
  { id: 'icode', icon: <CodeIcon size={SIZE} />, title: 'Inline code', action: inlineCode },
  { id: 'code', icon: <SquareCodeIcon size={SIZE} />, title: 'Code block', action: codeBlock },
  { id: 'link', icon: <LinkIcon size={SIZE} />, title: 'Link', action: link },
];

/**
 * Markdown formatting buttons. They format whatever editor is focused via the
 * registry — mousedown preventDefault keeps that editor's selection intact.
 */
export function MarkdownToolbar({ disabled }: { disabled?: boolean }) {
  return (
    <div className="md-toolbar" data-testid="md-toolbar">
      {BUTTONS.map((b) => (
        <button
          key={b.id}
          type="button"
          title={b.title}
          aria-label={b.title}
          disabled={disabled}
          data-testid={`md-${b.id}`}
          onMouseDown={(e) => {
            e.preventDefault();
            applyActiveFormat(b.action);
          }}
        >
          {b.icon}
        </button>
      ))}
    </div>
  );
}
