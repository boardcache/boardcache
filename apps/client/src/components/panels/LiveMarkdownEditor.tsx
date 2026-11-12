import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import type { LinkKind } from '../../lib/text/linkTitles';
import type { LiveEditorHandle } from '../../lib/text/liveMarkdown';
import { EmbedPortals } from './MarkdownEmbeds';
import { clearActiveEditor, setActiveEditor } from '../../lib/text/mdEditorRegistry';

export interface LiveMarkdownEditorRef {
  /** Put the caret on a (0-based) source line and scroll it into view. */
  goToLine: (line: number) => void;
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Styled in place (the live page) or plain source. */
  live: boolean;
  /** The properties block (frontmatter) folded away while live. */
  hideFrontmatter?: boolean;
  /** The opening `# Heading` folded away while live (the title bar shows it). */
  hideHeading?: boolean;
  /** A small picture for an `![[` completion's title. */
  completionThumb?: (title: string) => Node | null;
  /** Escape pressed inside the editor. */
  onEscape?: () => void;
  /** Titles offered while typing `[[` (notes) or `![[` (media). */
  linkTitles?: (kind: LinkKind) => string[];
  /** A rendered `![[embed]]` clicked: open its item. */
  onOpenEmbed?: (itemId: string) => void;
  /** A rendered `[[link]]` clicked (Ctrl/Cmd asks for a new tab). */
  onWikiLink?: (title: string, newTab: boolean) => void;
  /** A rendered link clicked. */
  onLink?: (url: string) => void;
  /** A note dragged in from the Notes list: its title, so `[[Title]]` lands
   *  where it was dropped. */
  dropNoteTitle?: (noteId: string) => string | null;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  testId?: string;
}

/**
 * The CodeMirror Markdown editor as a React component: Obsidian-style live
 * preview (markup hidden except on the selection's lines) or source view,
 * on the same document. The editor module loads on first use; the toolbar
 * formats it through the active-editor registry like the textarea editor.
 */
export const LiveMarkdownEditor = forwardRef<LiveMarkdownEditorRef, Props>(
  function LiveMarkdownEditor(props, ref) {
    const host = useRef<HTMLDivElement>(null);
    const handle = useRef<LiveEditorHandle | null>(null);
    const latest = useRef(props);
    useEffect(() => {
      latest.current = props;
    });
    const id = useId();
    const [ready, setReady] = useState(false);

    useEffect(() => {
      let dead = false;
      let made: LiveEditorHandle | null = null;
      void import('../../lib/text/liveMarkdown').then((mod) => {
        if (dead || !host.current) return;
        const p = latest.current;
        made = mod.createLiveEditor(host.current, {
          doc: p.value,
          live: p.live,
          hideFrontmatter: p.hideFrontmatter,
          hideHeading: p.hideHeading,
          placeholder: p.placeholder,
          onChange: (v) => latest.current.onChange(v),
          onEscape: () => latest.current.onEscape?.(),
          linkTitles: (kind) => latest.current.linkTitles?.(kind) ?? [],
          onWikiLink: (title, newTab) => latest.current.onWikiLink?.(title, newTab),
          onLink: (url) => latest.current.onLink?.(url),
          dropNoteTitle: (id) => latest.current.dropNoteTitle?.(id) ?? null,
          completionThumb: (title) => latest.current.completionThumb?.(title) ?? null,
          onFocus: () =>
            setActiveEditor({
              id,
              apply: (action) => made?.apply(action),
              read: () => made?.state() ?? null,
            }),
          onBlur: () => clearActiveEditor(id),
        });
        handle.current = made;
        if (p.autoFocus) made.focus();
        setReady(true);
      });
      return () => {
        dead = true;
        made?.destroy();
        handle.current = null;
        clearActiveEditor(id);
      };
    }, [id]);

    // Outside changes (a peer's commit, an undo, a tool) reach the editor.
    useEffect(() => {
      handle.current?.setValue(props.value);
    }, [props.value, ready]);
    useEffect(() => {
      handle.current?.setLive(props.live);
    }, [props.live, ready]);
    useEffect(() => {
      handle.current?.setHideFrontmatter(!!props.hideFrontmatter);
    }, [props.hideFrontmatter, ready]);
    useEffect(() => {
      handle.current?.setHideHeading(!!props.hideHeading);
    }, [props.hideHeading, ready]);

    useImperativeHandle(
      ref,
      () => ({
        goToLine: (line) => handle.current?.goToLine(line),
        focus: () => handle.current?.focus(),
      }),
      [],
    );

    return (
      <>
        <div
          ref={host}
          className={`md-live${props.live ? '' : ' md-live-source'}${props.className ? ` ${props.className}` : ''}`}
          data-testid={props.testId}
          data-ready={ready ? 'true' : undefined}
          onPointerDown={(e) => e.stopPropagation()}
          // The editor stays the toolbar's target while the focus is anywhere
          // inside it: the text, or a field of a rendered table.
          onFocusCapture={() =>
            setActiveEditor({
              id,
              apply: (action) => handle.current?.apply(action),
              read: () => handle.current?.state() ?? null,
            })
          }
          onBlurCapture={(e) => {
            if (!host.current?.contains(e.relatedTarget as Node | null)) clearActiveEditor(id);
          }}
        />
        <EmbedPortals
          root={host}
          onOpen={(id) => latest.current.onOpenEmbed?.(id)}
          onLayout={() => handle.current?.view.requestMeasure()}
        />
      </>
    );
  },
);
