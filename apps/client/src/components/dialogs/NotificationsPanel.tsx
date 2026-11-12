import { useEffect, useState } from 'react';
import { SettingsField, SettingsGroup, SettingsInput } from '../ui/SettingsForm';
import { UiSelect } from '../ui/Select';
import { LEAD_OPTIONS, useNotifyPrefs } from '../../lib/notifyPrefs';
import { ensureNotifyPermission } from '../../lib/structure/tasklist';
import { emailReminderSummary } from '../../lib/sync/emailReminders';
import { hasSyncServer } from '../../lib/sync/apiBase';
import { useSyncStore } from '../../state/syncStore';
import { desktopUi } from '../../lib/platform';
import { isNativeShell } from '../../lib/mobile';
import { showNotice } from '../../lib/notices';
import {
  disableWebPush,
  enableWebPush,
  webPushState,
  webPushSupported,
  type WebPushState,
} from '../../lib/push/webPush';

/**
 * Settings → Notifications: what this device shows and when, and whether
 * the account mails reminders as well. Everything here is kept per device
 * (the notifications are this device's); the email switch tells the server
 * what to schedule and is the one choice the server learns of.
 */
export function NotificationsPanel() {
  const prefs = useNotifyPrefs();
  const set = useNotifyPrefs((s) => s.set);
  const [permission, setPermission] = useState(() => systemPermission());
  const quiet = prefs.quietFrom !== null && prefs.quietTo !== null;
  return (
    <section className="settings-section" data-testid="settings-notifications">
      <h3>Notifications</h3>
      <SettingsGroup
        title="On this device"
        hint="Reminders are shown by the device the board is open on. Each device has its own settings."
        testId="notify-device"
      >
        <SettingsField label="Show notifications" hint={permissionHint(permission)}>
          <input
            type="checkbox"
            checked={prefs.enabled}
            data-testid="notify-enabled"
            onChange={(e) => {
              set({ enabled: e.target.checked });
              if (e.target.checked) {
                ensureNotifyPermission();
                setTimeout(() => setPermission(systemPermission()), 0);
              }
            }}
          />
        </SettingsField>
        {permission === 'default' && prefs.enabled && (
          <SettingsField
            label="Allow in the browser"
            hint="The browser asks once; without permission, reminders only show inside the app."
          >
            <button
              type="button"
              className="btn btn-sm"
              data-testid="notify-allow"
              onClick={() => {
                if (typeof Notification === 'undefined') return;
                void Notification.requestPermission().then(() => setPermission(systemPermission()));
              }}
            >
              Allow
            </button>
          </SettingsField>
        )}
        <SettingsField label="Tasks due" hint="Project tasks and checklist items.">
          <input
            type="checkbox"
            checked={prefs.tasks}
            disabled={!prefs.enabled}
            data-testid="notify-tasks"
            onChange={(e) => set({ tasks: e.target.checked })}
          />
        </SettingsField>
        <SettingsField label="Events" hint="Each event carries its own lead time.">
          <input
            type="checkbox"
            checked={prefs.events}
            disabled={!prefs.enabled}
            data-testid="notify-events"
            onChange={(e) => set({ events: e.target.checked })}
          />
        </SettingsField>
        <SettingsField
          label="Team and community activity"
          hint="Being added to a board, mentions and follows, when the window is in the background."
        >
          <input
            type="checkbox"
            checked={prefs.account}
            disabled={!prefs.enabled}
            data-testid="notify-account"
            onChange={(e) => set({ account: e.target.checked })}
          />
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup title="Timing" testId="notify-timing">
        <SettingsField
          label="Due dates without a time remind at"
          hint="A task due on a day, with no time set, reminds at this hour."
        >
          <SettingsInput
            type="time"
            value={prefs.dayTime}
            testId="notify-day-time"
            onChange={(e) => {
              if (e.target.value) set({ dayTime: e.target.value });
            }}
          />
        </SettingsField>
        <SettingsField label="Remind" hint="How far ahead of the due moment a task reminds.">
          <UiSelect
            value={String(prefs.leadMinutes)}
            ariaLabel="Lead time"
            testId="notify-lead"
            options={LEAD_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
            onChange={(v) => set({ leadMinutes: Number(v) })}
          />
        </SettingsField>
        <SettingsField
          label="Quiet hours"
          hint="A reminder that falls inside waits for the end of the quiet hours."
        >
          <input
            type="checkbox"
            checked={quiet}
            data-testid="notify-quiet"
            onChange={(e) =>
              set(
                e.target.checked
                  ? { quietFrom: '22:00', quietTo: '08:00' }
                  : { quietFrom: null, quietTo: null },
              )
            }
          />
        </SettingsField>
        {quiet && (
          <SettingsField label="From" testId="notify-quiet-span">
            <span className="notify-span">
              <SettingsInput
                type="time"
                value={prefs.quietFrom ?? ''}
                aria-label="Quiet from"
                testId="notify-quiet-from"
                onChange={(e) => {
                  if (e.target.value) set({ quietFrom: e.target.value });
                }}
              />
              <span className="settings-field-hint">to</span>
              <SettingsInput
                type="time"
                value={prefs.quietTo ?? ''}
                aria-label="Quiet to"
                testId="notify-quiet-to"
                onChange={(e) => {
                  if (e.target.value) set({ quietTo: e.target.value });
                }}
              />
            </span>
          </SettingsField>
        )}
      </SettingsGroup>

      {hasSyncServer() && <PushGroup />}
      {hasSyncServer() && <EmailGroup />}
    </section>
  );
}

/** Push to this browser through the account, for when the app is closed. */
function PushGroup() {
  const status = useSyncStore((s) => s.status);
  const prefs = useNotifyPrefs();
  const [state, setState] = useState<WebPushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void webPushState().then((st) => {
      if (live) setState(st);
    });
    return () => {
      live = false;
    };
  }, [status, prefs.push]);
  if (!webPushSupported()) {
    return (
      <SettingsGroup
        title="Push"
        hint={
          desktopUi()
            ? 'The desktop app shows reminders itself while it is open. Push reaches a browser or a home-screen web app when the app is closed.'
            : isNativeShell()
              ? 'The phone app receives push through the system; it is on while you are signed in.'
              : 'This browser cannot receive push. A reminder still shows while a board is open here, and by email if you turn that on.'
        }
        testId="notify-push-group"
      >
        {null}
      </SettingsGroup>
    );
  }
  const hint =
    state === null
      ? ''
      : state === 'signed-out'
        ? 'Sign in to have reminders reach this browser when the app is closed.'
        : state === 'no-server'
          ? 'This server has no push keys configured.'
          : state === 'no-key'
            ? 'Sign in again on this device: the key push needs is made at sign-in.'
            : state === 'blocked'
              ? 'Notifications are blocked for this site in the browser. Allow them in the site settings, then try again.'
              : state === 'on'
                ? 'Reminders and account events reach this browser while the app is closed. What a reminder says is sealed for your devices; the server learns only when.'
                : 'Reminders and account events reach this browser while the app is closed, once you allow notifications.';
  const on = state === 'on';
  const toggle = async (want: boolean) => {
    setBusy(true);
    try {
      if (want) {
        const res = await enableWebPush();
        if (!res.ok) showNotice(res.error, { id: 'web-push', kind: 'warn' });
      } else await disableWebPush();
    } finally {
      setBusy(false);
      setState(await webPushState());
    }
  };
  return (
    <SettingsGroup title="Push" hint={hint} testId="notify-push-group">
      <SettingsField label="Push to this browser">
        <input
          type="checkbox"
          checked={on}
          disabled={
            busy ||
            state === null ||
            state === 'signed-out' ||
            state === 'no-server' ||
            state === 'no-key' ||
            state === 'blocked'
          }
          data-testid="notify-push"
          onChange={(e) => void toggle(e.target.checked)}
        />
      </SettingsField>
    </SettingsGroup>
  );
}

/** Reminders by email through the account, for when the app is closed. */
function EmailGroup() {
  const prefs = useNotifyPrefs();
  const set = useNotifyPrefs((s) => s.set);
  const status = useSyncStore((s) => s.status);
  const profile = useSyncStore((s) => s.profile);
  const signedIn = status === 'signedIn';
  const [summary, setSummary] = useState<{ count: number; next: string | null } | null>(null);
  const wanted = signedIn && prefs.email;
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    // Give the sync a moment after a change, then read what the server holds.
    const t = setTimeout(() => {
      void emailReminderSummary().then((s) => {
        if (live) setSummary(s);
      });
    }, 2600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [wanted, prefs.emailTitles, prefs.tasks, prefs.events]);
  const address = profile?.email ?? '';
  const unverified = !!profile && !!address && profile.verifyEnabled && !profile.emailVerified;
  const hint = !signedIn
    ? 'Sign in to have reminders mailed to you as well, for when the app is closed.'
    : !address
      ? 'Add an email address to your profile first (Settings → Sync).'
      : unverified
        ? `Verify ${address} first (Settings → Sync).`
        : `Sent to ${address} at the moment a task or event comes due, whether or not the app is open. The server learns only when, and a link to open; not what the task is.`;
  return (
    <SettingsGroup title="Email" hint={hint} testId="notify-email-group">
      <SettingsField label="Email me reminders">
        <input
          type="checkbox"
          checked={prefs.email}
          disabled={!signedIn || !address || unverified}
          data-testid="notify-email"
          onChange={(e) => set({ email: e.target.checked })}
        />
      </SettingsField>
      <SettingsField
        label="Include task names"
        hint="Otherwise a reminder only says that something is due, with the link. A name in an email leaves the board's encryption."
      >
        <input
          type="checkbox"
          checked={prefs.emailTitles}
          disabled={!prefs.email}
          data-testid="notify-email-titles"
          onChange={(e) => set({ emailTitles: e.target.checked })}
        />
      </SettingsField>
      {wanted && summary && (
        <p className="settings-hint" data-testid="notify-email-summary">
          {summary.count === 0
            ? 'Nothing scheduled yet. Open a board with due dates ahead and they are registered.'
            : `${summary.count} reminder${summary.count === 1 ? '' : 's'} scheduled${summary.next ? `, the next ${whenLabel(summary.next)}` : ''}.`}
        </p>
      )}
    </SettingsGroup>
  );
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? `at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : `on ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

type Permission = 'granted' | 'denied' | 'default' | 'none';
function systemPermission(): Permission {
  if (isNativeShell()) return 'granted';
  if (typeof Notification === 'undefined') return 'none';
  return Notification.permission as Permission;
}

function permissionHint(p: Permission): string {
  if (desktopUi())
    return 'Delivered by the system, like any app. Reminders need the board to be open in the app.';
  if (p === 'granted') return 'Shown by the browser while a board is open in a tab.';
  if (p === 'denied')
    return 'The browser has blocked notifications for this site; allow them in its site settings to see reminders outside the app.';
  if (p === 'none') return 'This browser cannot show notifications; reminders show inside the app.';
  return 'Shown by the browser while a board is open in a tab.';
}
