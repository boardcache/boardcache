import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { clearActiveEditor, setActiveEditor } from '../../lib/text/mdEditorRegistry';
import {
  continueList,
  detectSlash,
  filterSlash,
  type EditAction,
  type EditState,
  type SlashCommand,
} from '../../lib/text/mdFormat';
import { caretCoords } from '../../lib/text/textareaCaret';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Fired on Escape, and on blur when `commitOnBlur` (commit / leave editing). */
  onDone?: () => void;
  /** Whether clicking away commits (canvas inline) or not (lightbox modal). */
  commitOnBlur?: boolean;
  autoFocus?: boolean;
  /** Grow the textarea to fit its content (canvas inline editing). */
  autoGrow?: boolean;
  /** Reports the editor's outer height after each (auto-)grow. */
  onHeight?: (height: number) => void;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  testId?: string;
}

/**
 * Raw-markdown <textarea> with the shared toolbar wiring (registers as the
 * active editor so toolbar buttons format it) and an Obsidian-style "/" menu.
 */
export function MarkdownEditor({
  value,
  onChange,
  onDone,
  commitOnBlur = true,
  autoFocus,
  autoGrow,
  onHeight,
  placeholder,
  className,
  style,
  testId,
}: Props) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSel = useRef<{ start: number; end: number } | null>(null);
  const [slash, setSlash] = useState<{ query: string; start: number } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashPos, setSlashPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const grow = () => {
    const el = ref.current;
    if (!el || !autoGrow) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    onHeight?.(el.offsetHeight);
  };

  // On open, focus with the caret at the end ("double-click to keep writing").
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && autoFocus) {
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
    grow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply pending selection (after a programmatic value change) + keep grown.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (pendingSel.current) {
      el.selectionStart = pendingSel.current.start;
      el.selectionEnd = pendingSel.current.end;
      pendingSel.current = null;
      el.focus();
    }
    grow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Recompute the "/" menu anchor whenever it opens or the query changes.
  useLayoutEffect(() => {
    if (!slash || !ref.current) return;
    const { top, left, height } = caretCoords(ref.current);
    setSlashPos({ top: top + height, left });
  }, [slash]);

  // Keep the highlighted row visible while arrowing through a scrolled menu.
  const menuRef = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    menuRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }, [slashIndex]);

  const applyAction = (action: EditAction) => {
    const el = ref.current;
    if (!el) return;
    const state: EditState = {
      value: el.value,
      selStart: el.selectionStart ?? el.value.length,
      selEnd: el.selectionEnd ?? el.value.length,
    };
    const next = action(state);
    pendingSel.current = { start: next.selStart, end: next.selEnd };
    onChange(next.value);
  };

  const refreshSlash = (el: HTMLTextAreaElement) => {
    const hit = detectSlash(el.value, el.selectionStart ?? 0);
    if (hit) {
      // Same query → keep the arrow-key highlight (keyup fires after every
      // ArrowDown; resetting here would pin the index to 0).
      if (!slash || slash.query !== hit.query || slash.start !== hit.start) {
        setSlash(hit);
        setSlashIndex(0);
      }
    } else if (slash) {
      setSlash(null);
    }
  };

  const choose = (cmd: SlashCommand) => {
    const el = ref.current;
    if (!el || !slash) return;
    const caret = el.selectionStart ?? 0;
    const cleaned = el.value.slice(0, slash.start) + el.value.slice(caret);
    const next = cmd.run({ value: cleaned, selStart: slash.start, selEnd: slash.start });
    setSlash(null);
    pendingSel.current = { start: next.selStart, end: next.selEnd };
    onChange(next.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation(); // never reach canvas / lightbox shortcuts
    if (slash) {
      const list = filterSlash(slash.query);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => (list.length ? (i + 1) % list.length : 0));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => (list.length ? (i - 1 + list.length) % list.length : 0));
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && list.length) {
        e.preventDefault();
        const cmd = list[Math.min(slashIndex, list.length - 1)];
        if (cmd) choose(cmd);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlash(null);
        return;
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onDone?.();
      return;
    }
    // Continue a bullet / numbered / task list on Enter (Shift+Enter is raw).
    if (e.key === 'Enter' && !e.shiftKey) {
      const el = e.currentTarget;
      const next = continueList({
        value: el.value,
        selStart: el.selectionStart ?? el.value.length,
        selEnd: el.selectionEnd ?? el.value.length,
      });
      if (next) {
        e.preventDefault();
        pendingSel.current = { start: next.selStart, end: next.selEnd };
        onChange(next.value);
      }
    }
  };

  const list = slash ? filterSlash(slash.query) : [];

  return (
    <div className="md-editor-wrap">
      <textarea
        ref={ref}
        className={`md-editor${className ? ` ${className}` : ''}`}
        style={style}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoFocus={autoFocus}
        data-testid={testId}
        onChange={(e) => {
          onChange(e.target.value);
          refreshSlash(e.target);
          grow();
        }}
        onKeyUp={(e) => refreshSlash(e.currentTarget)}
        onClick={(e) => refreshSlash(e.currentTarget)}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()} // caret drags, not canvas drags
        onFocus={() => setActiveEditor({ id, apply: applyAction })}
        onBlur={() => {
          clearActiveEditor(id);
          if (!commitOnBlur) return;
          // A toolbar/slash click refocuses synchronously; defer the commit so
          // those interactions aren't treated as "left the editor".
          setTimeout(() => {
            if (document.activeElement !== ref.current && !slash) onDone?.();
          }, 0);
        }}
      />
      {slash && list.length > 0 && (
        <ul
          ref={menuRef}
          className="md-slash-menu"
          style={{ top: slashPos.top, left: slashPos.left }}
          data-testid="md-slash-menu"
        >
          {list.map((cmd, i) => (
            <li key={cmd.id}>
              <button
                type="button"
                className={i === slashIndex ? 'active' : ''}
                // Keep the textarea focused; commit the command on mousedown.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(cmd);
                }}
              >
                <span className="md-slash-label">{cmd.label}</span>
                <span className="md-slash-hint">{cmd.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
