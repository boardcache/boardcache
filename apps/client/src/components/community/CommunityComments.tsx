import { useEffect, useState } from 'react';
import { AuthedImg } from '../ui/AuthedImg';
import { confirmDialog } from '../ui/Prompt';
import { BadgeCheckIcon } from '../icons';
import {
  communityAssetUrl,
  deleteComment,
  editComment,
  listComments,
  postComment,
  type CommunityComment,
} from '../../lib/sync/community';
import { SimpleMarkdown } from '../ui/SimpleMarkdown';

/**
 * Comments under a published board. Threads: a comment may answer another;
 * replies, at any depth, sit one step in from the top-level comment they
 * descend from. Bodies are simple markdown.
 */

const HINT = 'Markdown: **bold**, *italic*, `code`, links, lists';

function Composer({
  placeholder,
  initial = '',
  busy,
  error,
  submitLabel,
  testPrefix,
  onSubmit,
  onCancel,
  inline = false,
}: {
  placeholder: string;
  initial?: string;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  testPrefix: string;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
  inline?: boolean;
}) {
  const [text, setText] = useState(initial);
  return (
    <div className={`cmt-composer${inline ? ' inline' : ''}`}>
      <textarea
        value={text}
        placeholder={placeholder}
        data-testid={`${testPrefix}-input`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && text.trim()) onSubmit(text.trim());
          if (e.key === 'Escape' && onCancel) onCancel();
        }}
      />
      <div className="cmt-composer-foot">
        {error ? <p className="cmt-error">{error}</p> : <span className="cmt-hint">{HINT}</span>}
        <span className="cmt-actions">
          {onCancel && (
            <button
              type="button"
              className="community-preview-btn"
              onClick={onCancel}
              data-testid={`${testPrefix}-cancel`}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            className="sync-primary"
            disabled={busy || !text.trim()}
            data-testid={`${testPrefix}-post`}
            onClick={() => onSubmit(text.trim())}
          >
            {submitLabel}
          </button>
        </span>
      </div>
    </div>
  );
}

function Avatar({ comment }: { comment: CommunityComment }) {
  const a = comment.author;
  return (
    <span className="cmt-avatar" aria-hidden>
      {a.avatarAsset ? (
        <AuthedImg src={communityAssetUrl(a.avatarAsset)} alt="" />
      ) : (
        <span>{(a.displayName[0] ?? '@').toUpperCase()}</span>
      )}
    </span>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function CommunityComments({
  publicationId,
  signedIn,
  isOwner,
  onCount,
  onReport,
}: {
  publicationId: string;
  handle: string;
  slug: string;
  signedIn: boolean;
  /** The viewer owns the board: may remove any comment. */
  isOwner: boolean;
  onCount: (n: number) => void;
  onReport: (commentId: string) => void;
}) {
  const [comments, setComments] = useState<CommunityComment[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) {
      queueMicrotask(() => setComments([]));
      return;
    }
    let alive = true;
    void listComments(publicationId)
      .then((list) => alive && setComments(list))
      .catch(() => alive && setComments([]));
    return () => {
      alive = false;
    };
  }, [publicationId, signedIn]);

  const visible = (list: CommunityComment[]) => list.filter((c) => !c.deleted).length;
  const update = (next: CommunityComment[]) => {
    setComments(next);
    onCount(visible(next));
  };

  const run = async (work: () => Promise<CommunityComment[]>) => {
    setBusy(true);
    setError(null);
    try {
      update(await work());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the comment.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const post = (text: string, parentId: string | null) =>
    run(async () => {
      const c = await postComment(publicationId, text, parentId);
      return [...(comments ?? []), c];
    }).then((ok) => ok && setReplyTo(null));

  const save = (id: string, text: string) =>
    run(async () => {
      const c = await editComment(id, text);
      return (comments ?? []).map((x) => (x.id === id ? c : x));
    }).then((ok) => ok && setEditing(null));

  const remove = async (c: CommunityComment) => {
    const ok = await confirmDialog({
      title: 'Delete this comment?',
      body: 'It is removed for everyone. Replies to it stay.',
      confirmLabel: 'Delete comment',
    });
    if (!ok) return;
    await run(async () => {
      await deleteComment(c.id);
      const list = comments ?? [];
      const hasReply = list.some((x) => x.parentId === c.id && !x.deleted);
      return hasReply
        ? list.map((x) =>
            x.id === c.id
              ? {
                  ...x,
                  deleted: true,
                  body: '',
                  author: { handle: '', displayName: '', avatarAsset: null, founding: false },
                }
              : x,
          )
        : list.filter((x) => x.id !== c.id);
    });
  };

  // Threads: top-level comments in order, each followed by every descendant
  // (depth-first), all rendered one step in.
  const list = comments ?? [];
  const byParent = new Map<string | null, CommunityComment[]>();
  for (const c of list) {
    const k = c.parentId && list.some((x) => x.id === c.parentId) ? c.parentId : null;
    byParent.set(k, [...(byParent.get(k) ?? []), c]);
  }
  const ordered: { c: CommunityComment; reply: boolean }[] = [];
  const walk = (parent: string | null, reply: boolean) => {
    for (const c of byParent.get(parent) ?? []) {
      ordered.push({ c, reply });
      walk(c.id, true);
    }
  };
  walk(null, false);
  const count = visible(list);

  return (
    <section className="cd-comments" data-testid="cd-comments">
      <h2>
        {count} comment{count === 1 ? '' : 's'}
      </h2>
      {signedIn ? (
        replyTo === null && (
          <Composer
            placeholder="Add a comment"
            busy={busy}
            error={error}
            submitLabel="Post comment"
            testPrefix="cmt"
            onSubmit={(t) => void post(t, null)}
          />
        )
      ) : (
        <p className="cmt-signin">Sign in to join the conversation.</p>
      )}
      {comments === null ? null : ordered.length === 0 ? (
        <p className="cmt-empty" data-testid="cmt-empty">
          No comments yet.
        </p>
      ) : (
        <div className="cmt-thread">
          {ordered.map(({ c, reply }) => (
            <article
              key={c.id}
              className={`cmt${reply ? ' reply' : ''}`}
              data-testid={`cmt-${c.id}`}
              data-comment=""
            >
              <Avatar comment={c} />
              <div>
                {c.deleted ? (
                  <p className="cmt-body deleted">This comment was removed.</p>
                ) : (
                  <>
                    <div className="cmt-head">
                      <span className="cmt-name">{c.author.displayName}</span>
                      {c.author.founding && (
                        <span className="founding-badge" title="Founding member">
                          <BadgeCheckIcon size={13} />
                        </span>
                      )}
                      <span className="cmt-handle">@{c.author.handle}</span>
                      <span className="cmt-date">· {when(c.createdAt)}</span>
                      {c.editedAt && <span className="cmt-edited">(edited)</span>}
                    </div>
                    {editing === c.id ? (
                      <Composer
                        placeholder="Edit your comment"
                        initial={c.body}
                        busy={busy}
                        error={error}
                        submitLabel="Save"
                        testPrefix="cmt-edit"
                        inline
                        onSubmit={(t) => void save(c.id, t)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <SimpleMarkdown text={c.body} className="cmt-body" />
                    )}
                    {signedIn && editing !== c.id && (
                      <div className="cmt-foot">
                        <button type="button" onClick={() => setReplyTo(c.id)}>
                          Reply
                        </button>
                        {c.mine && (
                          <button type="button" onClick={() => setEditing(c.id)}>
                            Edit
                          </button>
                        )}
                        {(c.mine || isOwner) && (
                          <button type="button" onClick={() => void remove(c)}>
                            Delete
                          </button>
                        )}
                        {!c.mine && (
                          <button type="button" onClick={() => onReport(c.id)}>
                            Report
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
                {replyTo === c.id && (
                  <Composer
                    placeholder={`Reply to @${c.author.handle || 'comment'}`}
                    busy={busy}
                    error={error}
                    submitLabel="Reply"
                    testPrefix="cmt-reply"
                    inline
                    onSubmit={(t) => void post(t, c.id)}
                    onCancel={() => setReplyTo(null)}
                  />
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
