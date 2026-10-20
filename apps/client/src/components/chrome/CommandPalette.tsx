import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildPaletteCommands, type PaletteCommand } from '../../lib/commands';
import { useSessionStore } from '../../state/sessionStore';

/**
 * Command palette (Ctrl/Cmd+P, Obsidian-style): type-to-filter across the
 * app's actions, arrows + Enter to run. Commands are built fresh on open so
 * view/selection gating is current. Class names deliberately avoid the
 * modal/overlay tokens content blockers hide (see iOS notes).
 */

/** Rank: title word-start beats substring; keywords count at a discount. */
function score(cmd: PaletteCommand, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const title = cmd.title.toLowerCase();
  const hay = `${title} ${cmd.section.toLowerCase()} ${cmd.keywords ?? ''}`;
  let total = 0;
  for (const term of q.split(/\s+/)) {
    if (title.startsWith(term)) total += 100;
    else if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(title))
      total += 60;
    else if (title.includes(term)) total += 30;
    else if (hay.includes(term)) total += 10;
    else return 0; // every term must match somewhere
  }
  return total;
}

export function CommandPalette() {
  const open = useSessionStore((s) => s.paletteOpen);
  return open ? <PaletteBody /> : null;
}

function PaletteBody() {
  const close = () => useSessionStore.getState().setPaletteOpen(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Snapshot the registry once per open.
  const commands = useMemo(() => buildPaletteCommands(), []);

  const matches = useMemo(() => {
    const ranked = commands
      .map((c) => ({ c, s: score(c, query) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s);
    return ranked.map((r) => r.c);
  }, [commands, query]);

  const active = matches[Math.min(index, matches.length - 1)];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  // Escape closes even if focus never landed in the input (e.g. a menu's
  // focus restoration raced the autofocus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => {
    // Async reset — sync setState inside an effect cascades renders.
    queueMicrotask(() => setIndex(0));
  }, [query]);
  // Keep the active row in view while arrowing.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (cmd: PaletteCommand | undefined) => {
    if (!cmd) return;
    close();
    cmd.run();
  };

  return createPortal(
    <div className="cmdk-veil" data-testid="command-palette" onClick={close}>
      <div className="cmdk-panel" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          value={query}
          placeholder="Type a command"
          data-testid="cmdk-input"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, matches.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(active);
            }
          }}
        />
        <div className="cmdk-list" ref={listRef} role="listbox" aria-label="Commands">
          {matches.length === 0 && <p className="cmdk-empty">No matching commands.</p>}
          {matches.map((cmd) => (
            <button
              key={cmd.id}
              type="button"
              role="option"
              aria-selected={cmd === active}
              data-active={cmd === active || undefined}
              className={`cmdk-row${cmd === active ? ' active' : ''}`}
              data-testid={`cmdk-${cmd.id}`}
              onMouseEnter={() => setIndex(matches.indexOf(cmd))}
              onClick={() => run(cmd)}
            >
              <span className="cmdk-section">{cmd.section}</span>
              <span className="cmdk-title">{cmd.title}</span>
              {cmd.shortcut && <kbd className="cmdk-kbd">{cmd.shortcut}</kbd>}
            </button>
          ))}
        </div>
        <div className="cmdk-hint">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
