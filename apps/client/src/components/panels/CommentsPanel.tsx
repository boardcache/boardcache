import { useState } from 'react';
import type { Item } from '@boardcache/schema';
import { useShallow } from 'zustand/react/shallow';
import { addComment, removeComment } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { CloseIcon } from '../icons';
import { UserAvatar } from '../chrome/UserAvatar';

/**
 * Lightbox sidebar tab: the item's comment thread. Comments are document
 * state (schema v34), so they sync across devices and live team boards, and
 * survive exports. Authors are display snapshots (name + presence color).
 */

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function CommentsPanel({ item }: { item: Item }) {
  const comments = useDocumentStore(
    useShallow((s) =>
      Object.values(s.doc.comments)
        .filter((c) => c.itemId === item.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    ),
  );
  const [draft, setDraft] = useState('');

  const post = () => {
    if (!draft.trim()) return;
    addComment(item.id, draft);
    setDraft('');
  };

  return (
    <div className="comments-panel" data-testid="comments-panel">
      <div className="comments-list">
        {comments.length === 0 && (
          <p className="comments-empty" data-testid="comments-empty">
            No comments yet. Notes here travel with the board — and appear live for everyone on a
            team board.
          </p>
        )}
        {comments.map((c) => (
          <div className="comment-card" key={c.id} data-testid="comment">
            <div className="comment-head">
              <UserAvatar
                userId={c.userId}
                name={c.author}
                color={c.color}
                className="comment-avatar"
              />
              <span className="comment-author" style={c.color ? { color: c.color } : undefined}>
                {c.author}
              </span>
              <span className="comment-when">{when(c.createdAt)}</span>
              <button
                type="button"
                className="comment-delete"
                title="Delete comment"
                aria-label="Delete comment"
                data-testid="comment-delete"
                onClick={() => removeComment(c.id)}
              >
                <CloseIcon />
              </button>
            </div>
            <p className="comment-text">{c.text}</p>
          </div>
        ))}
      </div>
      <div className="comment-composer">
        <textarea
          value={draft}
          placeholder="Add a comment"
          data-testid="comment-input"
          maxLength={4000}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              post();
            }
          }}
        />
        <button
          type="button"
          className="sync-primary comment-post"
          disabled={!draft.trim()}
          data-testid="comment-post"
          onClick={post}
        >
          Comment
        </button>
      </div>
    </div>
  );
}
