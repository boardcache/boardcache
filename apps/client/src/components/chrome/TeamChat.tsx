import { useEffect, useRef, useState } from 'react';
import { UserAvatar } from './UserAvatar';
import { sendTeamChat, peerLabel } from '../../lib/sync/collab';
import { useCollabStore } from '../../state/collabStore';
import { CloseIcon } from '../icons';

/**
 * Team chat: a floating, draggable, resizable window (same design language
 * as the board assistant's floating chat). History rides the room socket —
 * the server keeps a rolling 200 messages per board.
 */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const RECT_KEY = 'boardcache:teamChatRect';

function loadRect(): Rect {
  try {
    const raw = JSON.parse(localStorage.getItem(RECT_KEY) ?? '') as Rect;
    if ([raw.x, raw.y, raw.w, raw.h].every((n) => typeof n === 'number')) return raw;
  } catch {
    /* defaults below */
  }
  return { x: window.innerWidth - 372, y: 96, w: 340, h: 420 };
}

const clampRect = (r: Rect): Rect => ({
  x: Math.min(Math.max(8 - r.w + 60, r.x), window.innerWidth - 60),
  y: Math.min(Math.max(8, r.y), window.innerHeight - 60),
  w: Math.min(Math.max(260, r.w), window.innerWidth - 16),
  h: Math.min(Math.max(240, r.h), window.innerHeight - 16),
});

export function TeamChatWindow() {
  const open = useCollabStore((s) => s.chatOpen);
  const chat = useCollabStore((s) => s.chat);
  const selfId = useCollabStore((s) => s.self?.name);
  const [rect, setRect] = useState<Rect>(loadRect);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    base: Rect;
  } | null>(null);

  // Stick to the bottom as messages arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, open]);

  if (!open) return null;

  const beginDrag = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, base: rect };
  };
  const onDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setRect(
      clampRect(
        d.mode === 'move'
          ? { ...d.base, x: d.base.x + dx, y: d.base.y + dy }
          : { ...d.base, w: d.base.w + dx, h: d.base.h + dy },
      ),
    );
  };
  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    localStorage.setItem(RECT_KEY, JSON.stringify(rect));
  };

  const send = () => {
    if (!draft.trim()) return;
    sendTeamChat(draft);
    setDraft('');
  };

  return (
    <div
      className="teamchat"
      data-testid="teamchat"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <div
        className="teamchat-head"
        onPointerDown={(e) => beginDrag(e, 'move')}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="teamchat-title">Team chat</span>
        <button
          type="button"
          className="teamchat-close"
          aria-label="Close chat"
          data-testid="teamchat-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => useCollabStore.getState().setChatOpen(false)}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="teamchat-scroll" ref={scrollRef} data-testid="teamchat-scroll">
        {chat.length === 0 && (
          <p className="teamchat-empty">No messages yet — say hi to the room.</p>
        )}
        {chat.map((m) => (
          <div
            key={m.id}
            className={`teamchat-msg${m.name === selfId ? ' own' : ''}`}
            data-testid="teamchat-msg"
          >
            <span className="teamchat-head">
              <UserAvatar
                userId={m.userId}
                name={m.name}
                color={m.color}
                className="teamchat-avatar"
              />
              <span className="teamchat-author" style={{ color: m.color }}>
                {peerLabel(m.name, m.role)}
              </span>
            </span>
            <span className="teamchat-text">{m.text}</span>
          </div>
        ))}
      </div>
      <div className="teamchat-composer">
        <input
          type="text"
          value={draft}
          placeholder="Message the room"
          data-testid="teamchat-input"
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') send();
          }}
        />
        <button type="button" className="teamchat-send" data-testid="teamchat-send" onClick={send}>
          Send
        </button>
      </div>
      <div
        className="teamchat-resize"
        data-testid="teamchat-resize"
        onPointerDown={(e) => beginDrag(e, 'resize')}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  );
}
