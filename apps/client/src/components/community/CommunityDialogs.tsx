import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { UiDialog } from '../ui/Dialog';
import { UiSelect } from '../ui/Select';
import {
  communityAvailable,
  communityPageUrl,
  createPublication,
  fetchMyProfile,
  listPublications,
  uploadCover,
  uploadVersion,
  type CommunityProfile,
  type CommunityPublication,
} from '../../lib/sync/community';
import { SharingFields, parsePeople, type SharingValue } from '../dialogs/SharingFields';
import { useConnectivity } from '../../lib/platform';
import { useDocumentStore } from '../../state/documentStore';
import { useSyncStore } from '../../state/syncStore';

/**
 * Community UI: the publish dialog (File → Publish to Community) and the
 * browser (Library → Community). Both are dormant unless the server offers
 * the feature and the user is signed in.
 */

interface PublishState {
  open: boolean;
  toggle: (open: boolean) => void;
}
export const useCommunityPublish = create<PublishState>((set) => ({
  open: false,
  toggle: (open) => set({ open }),
}));

/** Reactive "server has community + user signed in" flag. Asked again on
 *  sign-in and whenever the server becomes reachable, so a probe that failed
 *  earlier never leaves the section hidden. */
export function useCommunityReady(): boolean {
  const signedIn = useSyncStore((s) => s.status === 'signedIn');
  const { serverReachable } = useConnectivity();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void communityAvailable().then((ok) => {
      if (!cancelled) setAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, serverReachable]);
  return available && signedIn;
}

const LICENSE_OPTIONS = [
  { value: 'all-rights-reserved', label: 'All rights reserved' },
  { value: 'cc-by', label: 'CC BY 4.0 — reuse with credit' },
  { value: 'cc-by-sa', label: 'CC BY-SA 4.0 — share-alike' },
  { value: 'cc-by-nc', label: 'CC BY-NC 4.0 — non-commercial' },
  { value: 'cc0', label: 'CC0 — public domain' },
];

export function CommunityPublishDialog() {
  const open = useCommunityPublish((s) => s.open);
  return open ? <PublishBody /> : null;
}

function PublishBody() {
  const close = () => useCommunityPublish.getState().toggle(false);
  const doc = useDocumentStore.getState().doc;

  const [profile, setProfile] = useState<CommunityProfile | null | 'loading'>('loading');
  const [mine, setMine] = useState<CommunityPublication[]>([]);
  // '' = new publication, else the existing publication id to version.
  const [target, setTarget] = useState('');
  const [title, setTitle] = useState(doc.name || 'Untitled board');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [license, setLicense] = useState('all-rights-reserved');
  const [changelog, setChangelog] = useState('');
  const [includeComments, setIncludeComments] = useState(false);
  const [attest, setAttest] = useState(false);
  const [sharing, setSharing] = useState<SharingValue>({
    visibility: 'public',
    groupIds: [],
    people: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{
    handle: string;
    slug: string;
    version: number;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const p = await fetchMyProfile();
        setProfile(p);
        if (p) setMine(await listPublications({ mine: true }));
      } catch (err) {
        setProfile(null);
        setError(err instanceof Error ? err.message : 'Community is unavailable.');
      }
    })();
  }, []);

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      let id = target;
      let slug = mine.find((m) => m.id === target)?.slug ?? '';
      if (!id) {
        const created = await createPublication({
          title: title.trim(),
          description: description.trim(),
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          license,
          attest,
          visibility: sharing.visibility,
          groupIds: sharing.groupIds,
          people: parsePeople(sharing.people),
        });
        id = created.id;
        slug = created.slug;
      }
      const version = await uploadVersion(id, doc, {
        includeComments,
        ...(changelog.trim() ? { changelog: changelog.trim() } : {}),
      });
      await uploadCover(id, version, doc);
      setPublished({ handle: (profile as CommunityProfile).handle, slug, version });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publishing failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <UiDialog
      title="Publish to Community"
      onClose={close}
      className="cmty-sheet"
      testId="community-publish"
    >
      <div className="cmty-body">
        {profile === 'loading' ? (
          <div className="skeleton-wrap" aria-label="Loading">
            <span className="skeleton-line lg" />
            <span className="skeleton-line" />
            <span className="skeleton-line short" />
          </div>
        ) : published ? (
          <div className="cmty-done" data-testid="community-published">
            <p>
              Published <strong>v{published.version}</strong> — your board is live at{' '}
              <a
                href={communityPageUrl(published.handle, published.slug)}
                target="_blank"
                rel="noreferrer noopener"
              >
                {communityPageUrl(published.handle, published.slug)}
              </a>
            </p>
            <button type="button" className="sync-primary" onClick={close}>
              Done
            </button>
          </div>
        ) : profile === null ? (
          <div className="cmty-claim" data-testid="community-unavailable">
            <p className="cmty-error">{error ?? 'Community is unavailable.'}</p>
          </div>
        ) : (
          <>
            <p className="cmty-hint">
              Publishing uploads a <strong>public, unencrypted snapshot</strong> of this board. Your
              synced boards stay end-to-end encrypted — only what you publish is public.
            </p>
            {error && <p className="cmty-error">{error}</p>}
            {mine.length > 0 && (
              <UiSelect
                ariaLabel="Publish as"
                testId="community-target"
                value={target || 'new'}
                onChange={(v) => setTarget(v === 'new' ? '' : v)}
                options={[
                  { value: 'new', label: 'New publication' },
                  ...mine.map((m) => ({
                    value: m.id,
                    label: `Update “${m.title}” (v${(m.latestVersion ?? 0) + 1})`,
                  })),
                ]}
              />
            )}
            {!target && (
              <>
                <input
                  className="cmty-title"
                  value={title}
                  placeholder="Title"
                  data-testid="community-title"
                  onChange={(e) => setTitle(e.target.value)}
                />
                <textarea
                  value={description}
                  placeholder="What is this board? (shown on the public page)"
                  data-testid="community-description"
                  onChange={(e) => setDescription(e.target.value)}
                />
                <input
                  value={tags}
                  placeholder="Tags, comma separated (max 8)"
                  data-testid="community-tags"
                  onChange={(e) => setTags(e.target.value)}
                />
                <UiSelect
                  ariaLabel="License"
                  testId="community-license"
                  value={license}
                  onChange={setLicense}
                  options={LICENSE_OPTIONS}
                />
                <SharingFields value={sharing} onChange={setSharing} />
              </>
            )}
            {target && (
              <input
                value={changelog}
                placeholder="What changed in this version?"
                data-testid="community-changelog"
                onChange={(e) => setChangelog(e.target.value)}
              />
            )}
            <label className="cmty-check">
              <input
                type="checkbox"
                checked={includeComments}
                onChange={(e) => setIncludeComments(e.target.checked)}
              />
              Include comments &amp; notes (they’re often private annotations)
            </label>
            <label className="cmty-check">
              <input
                type="checkbox"
                checked={attest}
                data-testid="community-attest"
                onChange={(e) => setAttest(e.target.checked)}
              />
              I have the rights to publish everything on this board, and I understand it will be
              publicly visible and cloneable.
            </label>
            <div className="cmty-actions">
              <button
                type="button"
                className="sync-primary"
                disabled={busy || !attest || (!target && !title.trim())}
                data-testid="community-publish-btn"
                onClick={() => void publish()}
              >
                {busy ? 'Publishing' : target ? 'Publish New Version' : 'Publish'}
              </button>
            </div>
          </>
        )}
      </div>
    </UiDialog>
  );
}
