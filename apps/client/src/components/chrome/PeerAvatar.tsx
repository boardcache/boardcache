import { useState } from 'react';
import { apiUrl } from '../../lib/sync/apiBase';
import { AuthedImg } from '../ui/AuthedImg';
import type { CollabPeer } from '../../state/collabStore';
import { useCollabStore } from '../../state/collabStore';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

/**
 * A team peer's avatar chip: their uploaded image when they have one (served
 * by the room's member-avatar route, guests included in the audience), else
 * their initials on their presence color.
 */
export function PeerAvatar({
  peer,
  className = 'team-avatar',
}: {
  peer: CollabPeer;
  className?: string;
}) {
  const boardId = useCollabStore((s) => s.boardId);
  const guestSlug = useCollabStore((s) => s.guestSlug);
  const role = useCollabStore((s) => s.role);
  const [broken, setBroken] = useState(false);

  if (peer.hasAvatar && boardId && !broken) {
    const q = role === 'guest' && guestSlug ? `?guest=${encodeURIComponent(guestSlug)}` : '';
    return (
      <AuthedImg
        className={`${className} peer-avatar-img`}
        src={apiUrl(`/api/team/${boardId}/member-avatar/${peer.id}${q}`)}
        alt={peer.name}
        style={{ borderColor: peer.color }}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className={className} style={{ background: peer.color }}>
      {initials(peer.name)}
    </span>
  );
}
