import { hasSyncServer } from '../../lib/sync/apiBase';
import { probeServer, useConnectivity } from '../../lib/platform';
import { enableBoardSync, reconcile } from '../../lib/sync/boardSync';
import { useSessionStore } from '../../state/sessionStore';
import { useSyncStore } from '../../state/syncStore';
import { ArrowUpIcon, CloudCheckIcon, CloudIcon, CloudOffIcon, MailIcon } from '../icons';
import { canPurchase } from '../../lib/mobile';

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * Sync indicator + entry point. With a `boardId` (on the canvas) it reflects
 * THIS board's sync state — signing in never auto-syncs a board, so an
 * un-opted board reads "Sync this board" rather than the account's status.
 * Without a boardId (the library header) it shows account-level activity.
 */
export function SyncStatus({
  boardId,
  testId = 'sync-status',
}: {
  boardId?: string;
  testId?: string;
}) {
  const status = useSyncStore((s) => s.status);
  const account = useSyncStore((s) => s.account);
  const activity = useSyncStore((s) => s.activity);
  const progress = useSyncStore((s) => s.progress);
  const detail = useSyncStore((s) => s.detail);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const boardSynced = useSyncStore((s) => (boardId ? s.syncedBoardIds.includes(boardId) : true));
  // A plan with no sync at all (Free on a hosted server): the pill sells the
  // upgrade instead of claiming "Synced" for boards that never leave the device.
  const noSync = useSyncStore((s) => s.entitlements?.limits.syncBytes === 0);
  // Until the address is confirmed, the account can do nothing else.
  const unverified = useSyncStore(
    (s) => s.profile?.verifyEnabled === true && !s.profile.emailVerified,
  );
  // …and until billing is switched on, there is nothing to upgrade to yet.
  // The iOS shell never talks about buying (App Store rules); it just says local.
  const billing = useSyncStore((s) => s.entitlements?.billing === true) && canPurchase();
  const { serverReachable, internetUp } = useConnectivity();

  if (!hasSyncServer()) return null;
  if (status === 'loading') return null;

  // Connectivity trumps everything: server-backed features are on hold, the
  // local tier keeps working, and clicking retries immediately.
  if (serverReachable === false) {
    return (
      <button
        type="button"
        className="sync-status is-warn"
        data-testid={testId}
        data-activity="unreachable"
        onClick={() => void probeServer()}
        title={
          internetUp
            ? 'Your sync server is unreachable — working locally. Sync, teams, community, and AI resume when it\u2019s back. Click to retry.'
            : 'You\u2019re offline — working locally. Changes sync when you reconnect.'
        }
      >
        <CloudOffIcon />
        <span className="sync-status-label">{internetUp ? 'Server unreachable' : 'Offline'}</span>
      </button>
    );
  }

  if (status !== 'signedIn') {
    return (
      <button
        type="button"
        className="sync-status"
        data-testid={testId}
        data-activity="signedOut"
        onClick={() => useSessionStore.getState().setSyncDialogOpen(true)}
        title="Sign in to sync your boards across devices"
      >
        <CloudIcon />
        <span className="sync-status-label">Sign in to sync</span>
      </button>
    );
  }

  const who = account?.username ?? '';

  if (unverified) {
    return (
      <button
        type="button"
        className="sync-status is-warn"
        data-testid={testId}
        data-activity="unverified"
        onClick={() => useSessionStore.getState().setSyncDialogOpen(true)}
        title={`${who} — enter the code we emailed you to start syncing.`}
      >
        <MailIcon />
        <span className="sync-status-label">Verify your email</span>
      </button>
    );
  }

  if (noSync) {
    return (
      <button
        type="button"
        className="sync-status"
        data-testid={testId}
        data-activity="noPlan"
        onClick={() => {
          useSessionStore.getState().setSettingsSection('sync');
          useSessionStore.getState().setSettingsOpen(true);
        }}
        title={
          billing
            ? `${who} — boards stay on this device. Upgrade to back them up and sync across devices.`
            : canPurchase()
              ? `${who} — boards stay on this device. Paid plans with sync aren't open yet.`
              : `${who} — boards stay on this device.`
        }
      >
        {billing ? <ArrowUpIcon /> : <CloudIcon />}
        <span className="sync-status-label">
          {billing ? 'Upgrade to sync' : canPurchase() ? 'Sync coming soon' : 'Local boards'}
        </span>
      </button>
    );
  }

  // Signed in, but THIS board hasn't been opted into sync.
  if (boardId && !boardSynced) {
    return (
      <button
        type="button"
        className="sync-status"
        data-testid={testId}
        data-activity="boardUnsynced"
        onClick={() => void enableBoardSync(boardId)}
        title={`${who} — this board isn't synced. Click to sync it to your account.`}
      >
        <CloudIcon />
        <span className="sync-status-label">Sync this board</span>
      </button>
    );
  }

  let icon: React.ReactNode;
  let label: React.ReactNode;
  let cls = '';
  let title: string;
  let onClick = () => useSessionStore.getState().setSyncDialogOpen(true);
  const subject = boardId ? 'This board' : who;

  if (activity === 'syncing') {
    icon = <span className="sync-spinner" aria-hidden />;
    label = detail ?? 'Syncing';
    title = `${subject} — syncing`;
  } else if (activity === 'offline') {
    icon = <CloudOffIcon />;
    label = 'Offline';
    cls = 'is-warn';
    title = `${subject} — offline; changes will sync when you reconnect`;
  } else if (activity === 'error') {
    icon = <CloudOffIcon />;
    label = 'Sync failed';
    cls = 'is-warn';
    title = `${subject} — ${detail ?? 'sync failed'}; click to retry`;
    onClick = () => void reconcile();
  } else {
    icon = <CloudCheckIcon />;
    label = 'Synced';
    cls = 'is-ok';
    title = lastSyncedAt
      ? `${subject} — last synced ${ago(lastSyncedAt)}`
      : `${subject} — up to date`;
  }

  return (
    <button
      type="button"
      className={`sync-status ${cls}`}
      data-testid={testId}
      data-activity={activity}
      onClick={onClick}
      title={title}
    >
      {icon}
      <span className="sync-status-label">{label}</span>
      {activity === 'syncing' && progress !== null && (
        <span className="sync-progressbar" aria-hidden>
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
      )}
    </button>
  );
}
