import { isNativeShell } from './mobile';

/**
 * Thin, import-free access to the iOS shell's native plugins (Swift, in
 * the iOS shell) and the Capacitor packages it bundles.
 * Every call is a no-op outside the shell, so shared code (notifications,
 * OCR, gestures) can use these without knowing where it runs. The heavier
 * boot wiring lives in iosShell.ts; this file must stay light enough for
 * any bundle, the viewer's single-file build included.
 */
type Impact = 'light' | 'medium' | 'heavy';

interface WidgetBoard {
  id: string;
  name: string;
  updatedAt: string;
}
interface WidgetTask {
  title: string;
  board: string;
  due: string;
}
export interface WidgetData {
  boards?: WidgetBoard[];
  inbox?: number;
  tasks?: WidgetTask[];
}

interface NativePlugins {
  Biometric?: {
    available(): Promise<{ available: boolean; kind: 'faceId' | 'touchId' | 'none' }>;
    authenticate(o: { reason: string }): Promise<{ ok: boolean }>;
  };
  Haptics?: { impact(o: { style: 'LIGHT' | 'MEDIUM' | 'HEAVY' }): Promise<void> };
  LocalNotifications?: {
    requestPermissions(): Promise<{ display: string }>;
    schedule(o: {
      notifications: {
        id: number;
        title: string;
        body?: string | undefined;
        schedule?: { at: Date } | undefined;
        extra?: Record<string, unknown> | undefined;
      }[];
    }): Promise<unknown>;
    cancel(o: { notifications: { id: number }[] }): Promise<void>;
    getPending(): Promise<{ notifications: { id: number }[] }>;
  };
  Vision?: {
    available(): Promise<{ scanner: boolean; text: boolean }>;
    scanDocument(): Promise<{ pages: { b64: string; mime: string }[] }>;
    recognizeText(o: { b64: string }): Promise<{ text: string }>;
  };
  WidgetData?: { update(o: { json: string }): Promise<void> };
}

function native(): NativePlugins {
  if (!isNativeShell()) return {};
  return (window as { Capacitor?: { Plugins?: NativePlugins } }).Capacitor?.Plugins ?? {};
}

/** Face ID / Touch ID: what the device offers, if anything. */
export async function biometricKind(): Promise<'faceId' | 'touchId' | null> {
  const b = native().Biometric;
  if (!b) return null;
  try {
    const r = await b.available();
    return r.available && r.kind !== 'none' ? r.kind : null;
  } catch {
    return null;
  }
}

/** Run the system prompt; true when the person passed it. */
export async function biometricUnlock(reason = 'Unlock boardCache'): Promise<boolean> {
  const b = native().Biometric;
  if (!b) return false;
  try {
    return (await b.authenticate({ reason })).ok;
  } catch {
    return false;
  }
}

/** A tap of feedback (drop, snap, attach). Nothing anywhere else. */
export function haptic(style: Impact = 'light'): void {
  const h = native().Haptics;
  if (!h) return;
  void h
    .impact({ style: style.toUpperCase() as 'LIGHT' | 'MEDIUM' | 'HEAVY' })
    .catch(() => undefined);
}

/** A stable small integer for a notification id (the plugin wants int32). */
function notificationId(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 1) % 2_000_000_000;
}

/** Show a notification now through the system (the shell's twin of web Notification). */
export function localNotifyNow(title: string, body?: string, key = title): boolean {
  const ln = native().LocalNotifications;
  if (!ln) return false;
  void ln
    .requestPermissions()
    .then(() => ln.schedule({ notifications: [{ id: notificationId(key), title, body }] }))
    .catch(() => undefined);
  return true;
}

/**
 * Replace the set of scheduled reminders: the app may be closed when a task
 * falls due, so every future one is handed to the system in advance.
 */
export interface LocalReminder {
  key: string;
  title: string;
  body?: string;
  at: number;
  path?: string;
}

const reminderSources = new Map<string, LocalReminder[]>();

/** Each caller (project tasks, events) owns a named slice; the system holds the union. */
export async function scheduleLocalReminders(
  list: LocalReminder[],
  source = 'tasks',
): Promise<void> {
  reminderSources.set(source, list);
  const ln = native().LocalNotifications;
  if (!ln) return;
  try {
    const pending = await ln.getPending();
    if (pending.notifications.length) await ln.cancel({ notifications: pending.notifications });
    const future = [...reminderSources.values()]
      .flat()
      .filter((r) => r.at > Date.now())
      .sort((a, b) => a.at - b.at);
    if (future.length === 0) return;
    await ln.requestPermissions();
    await ln.schedule({
      notifications: future.slice(0, 60).map((r) => ({
        id: notificationId(r.key),
        title: r.title,
        body: r.body,
        schedule: { at: new Date(r.at) },
        extra: r.path ? { path: r.path } : undefined,
      })),
    });
  } catch {
    /* the in-app timers still fire while the app is open */
  }
}

/** On-device OCR and the document scanner (VisionKit); null when absent. */
export async function visionCaps(): Promise<{ scanner: boolean; text: boolean } | null> {
  const v = native().Vision;
  if (!v) return null;
  try {
    return await v.available();
  } catch {
    return null;
  }
}

/** Scan with the camera's document mode; each page comes back as a JPEG file. */
export async function scanDocument(): Promise<File[]> {
  const v = native().Vision;
  if (!v) return [];
  const { pages } = await v.scanDocument();
  return pages.map((p, i) => {
    const bytes = Uint8Array.from(atob(p.b64), (c) => c.charCodeAt(0));
    return new File([bytes], `scan-${i + 1}.jpg`, { type: p.mime || 'image/jpeg' });
  });
}

/** Text in an image, recognised on the device; null when unavailable. */
export async function recognizeTextOnDevice(b64: string): Promise<string | null> {
  const v = native().Vision;
  if (!v) return null;
  try {
    return (await v.recognizeText({ b64 })).text;
  } catch {
    return null;
  }
}

let widget: WidgetData = {};
let widgetTimer: ReturnType<typeof setTimeout> | undefined;
/** Merge into the widget feed (recent boards, inbox count, tasks due) and hand it to WidgetKit. */
export function publishWidgetData(partial: WidgetData): void {
  const w = native().WidgetData;
  if (!w) return;
  widget = { ...widget, ...partial };
  clearTimeout(widgetTimer);
  widgetTimer = setTimeout(() => {
    void w
      .update({ json: JSON.stringify({ ...widget, at: new Date().toISOString() }) })
      .catch(() => undefined);
  }, 500);
}
