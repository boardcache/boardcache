import type { ReactNode } from 'react';
import { applyActiveFormat, getActiveEditor } from '../../lib/text/mdEditorRegistry';
import { useEmbedPicker } from './EmbedPickerDialog';
import { TableButton } from './TableButton';
import {
  bold,
  bulletList,
  codeBlock,
  embedItem,
  heading,
  inlineCode,
  italic,
  link,
  noteLink,
  numberedList,
  quote,
  strikethrough,
  taskList,
  type EditAction,
} from '../../lib/text/mdFormat';
import {
  BoldIcon,
  CodeIcon,
  EmbedIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListChecksIcon,
  NoteLinkIcon,
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
  /** Opens a picker for the active editor rather than editing at once. */
  picker?: boolean;
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
  { id: 'notelink', icon: <NoteLinkIcon size={SIZE} />, title: 'Link to a note', action: noteLink },
  {
    id: 'embed',
    icon: <EmbedIcon size={SIZE} />,
    title: 'Embed a picture or another item of the board',
    action: embedItem,
    picker: true,
  },
];

/**
 * Markdown formatting buttons. They format whatever editor is focused via the
 * registry — mousedown preventDefault keeps that editor's selection intact.
 */
export function MarkdownToolbar({ disabled, extra }: { disabled?: boolean; extra?: ReactNode }) {
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
            if (b.picker) {
              // The picker takes the focus: remember the editor it is for.
              useEmbedPicker.getState().openFor(getActiveEditor());
              return;
            }
            applyActiveFormat(b.action);
          }}
        >
          {b.icon}
        </button>
      ))}
      <TableButton disabled={disabled} />
      {extra && (
        <>
          <span className="tsp-divider" aria-hidden />
          {extra}
        </>
      )}
    </div>
  );
}
