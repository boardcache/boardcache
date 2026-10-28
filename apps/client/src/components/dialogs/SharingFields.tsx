import { useEffect, useState } from 'react';
import { UiSelect } from '../ui/Select';
import { listGroups, type CommunityGroup } from '../../lib/sync/community';

/**
 * Publication audience controls, shared by the publish and edit-post
 * dialogs: Public / Groups (pick from your groups) / Specific people
 * (usernames). Restricted boards are access-controlled plaintext on the
 * server — the hint says so plainly.
 */

export interface SharingValue {
  visibility: 'public' | 'groups' | 'private';
  /** Public boards only: anyone may read the board by its address, no account needed. */
  openLink: boolean;
  groupIds: string[];
  people: string; // comma-separated usernames, parsed by the caller
}

export function SharingFields({
  value,
  onChange,
}: {
  value: SharingValue;
  onChange: (next: SharingValue) => void;
}) {
  const [groups, setGroups] = useState<CommunityGroup[] | null>(null);
  useEffect(() => {
    if (value.visibility !== 'groups' || groups !== null) return;
    void listGroups()
      .then((g) => setGroups(g.mine))
      .catch(() => setGroups([]));
  }, [value.visibility, groups]);

  return (
    <>
      <div className="cmty-field">
        <span>Who can see this</span>
        <UiSelect
          ariaLabel="Visibility"
          testId="share-visibility"
          value={value.visibility}
          onChange={(v) => onChange({ ...value, visibility: v as SharingValue['visibility'] })}
          options={[
            { value: 'public', label: 'Public — everyone on the community' },
            { value: 'groups', label: 'Groups — members of chosen groups' },
            { value: 'private', label: 'Specific people' },
          ]}
        />
      </div>
      {value.visibility === 'public' && (
        <label className="cmty-check">
          <input
            type="checkbox"
            checked={value.openLink}
            data-testid="share-open-link"
            onChange={(e) => onChange({ ...value, openLink: e.target.checked })}
          />
          Anyone with the link can view it, no account needed
        </label>
      )}
      {value.visibility === 'groups' && (
        <div className="cmty-field" data-testid="share-groups">
          <span>Share with groups</span>
          {groups === null ? (
            <p className="cmty-hint">Loading your groups</p>
          ) : groups.length === 0 ? (
            <p className="cmty-hint">
              You’re not in any groups yet — create one from the Community sidebar first.
            </p>
          ) : (
            <div className="share-group-list">
              {groups.map((g) => (
                <label className="cmty-check" key={g.id}>
                  <input
                    type="checkbox"
                    checked={value.groupIds.includes(g.id)}
                    data-testid={`share-group-${g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        groupIds: e.target.checked
                          ? [...value.groupIds, g.id]
                          : value.groupIds.filter((id) => id !== g.id),
                      })
                    }
                  />
                  <span>
                    {g.name} · {g.members} member{g.members === 1 ? '' : 's'}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      {value.visibility === 'private' && (
        <label className="cmty-field">
          <span>Share with (usernames, comma separated)</span>
          <input
            value={value.people}
            placeholder="alex, jamie"
            data-testid="share-people"
            onChange={(e) => onChange({ ...value, people: e.target.value })}
          />
        </label>
      )}
      {value.visibility !== 'public' && (
        <p className="cmty-hint">
          Restricted boards are hidden from the feed, pages, and search for anyone else. They’re
          access-controlled on the server (not end-to-end encrypted like private sync).
        </p>
      )}
    </>
  );
}

export const parsePeople = (raw: string): string[] =>
  raw
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
