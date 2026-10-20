import { useState } from 'react';
import { apiUrl } from '../../lib/sync/apiBase';
import { useCollabStore } from '../../state/collabStore';
import { useSyncStore } from '../../state/syncStore';

const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

/**
 * Avatar chip for a durable author reference (chat history, doc comments):
 * resolves by ACCOUNT id — own avatar via the profile route, teammates via
 * the room-scoped member route. Anyone unresolvable (guests, signed-out,
 * local boards) gets an initial on the author color.
 */
export function UserAvatar({
  userId,
  name,
  color,
  className = 'user-avatar',
}: {
  userId?: string | null | undefined;
  name: string;
  color?: string | undefined;
  className?: string;
}) {
  const boardId = useCollabStore((s) => s.boardId);
  const guestSlug = useCollabStore((s) => s.guestSlug);
  const role = useCollabStore((s) => s.role);
  const myId = useSyncStore((s) => s.account?.id ?? null);
  const hasOwnAvatar = useSyncStore((s) => s.profile?.hasAvatar ?? false);
  const [broken, setBroken] = useState(false);

  let src: string | null = null;
  if (userId && !broken) {
    if (userId === myId && hasOwnAvatar) {
      src = apiUrl('/api/profile/avatar');
    } else if (userId !== myId && boardId) {
      const q = role === 'guest' && guestSlug ? `?guest=${encodeURIComponent(guestSlug)}` : '';
      src = apiUrl(`/api/team/${boardId}/user-avatar/${userId}${q}`);
    }
  }

  if (src) {
    return (
      <img
        className={`${className} peer-avatar-img`}
        src={src}
        alt={name}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className={className} style={color ? { background: color } : undefined}>
      {initial(name)}
    </span>
  );
}
