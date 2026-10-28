import { useEffect, useState } from 'react';
import { confirmDialog } from '../ui/Prompt';
import { desktopClips, type ClipPairing } from '../../lib/platform';

/**
 * Settings → General, desktop only: pair the browser clipper with this app.
 * The clipper sends clips straight here over localhost, with no account and
 * no server; the code is the port and a clip-only key in one string.
 */
export function ClipperPairingSection() {
  const clips = desktopClips();
  const [pairing, setPairing] = useState<ClipPairing | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void clips
      ?.pairing()
      .then(setPairing)
      .catch(() => undefined);
  }, [clips]);
  if (!clips || !pairing?.code) return null;
  const code = pairing.code;

  return (
    <section className="settings-section" data-testid="settings-clipper">
      <h3>Browser clipper</h3>
      <p className="settings-hint">
        The boardCache Clipper for Chrome and Firefox can send what you clip straight to this app,
        with no account. In the clipper's settings choose This computer and paste this code:
      </p>
      <div className="settings-command">
        <code data-testid="settings-clipper-code">{code}</code>
        <button
          type="button"
          className="settings-copy"
          data-testid="settings-clipper-copy"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="settings-command settings-command-actions">
        <button
          type="button"
          className="settings-copy"
          data-testid="settings-clipper-regenerate"
          onClick={() => {
            void (async () => {
              const ok = await confirmDialog({
                title: 'New clipper code',
                body: 'Browsers paired with the current code stop sending clips here until you paste the new one.',
                confirmLabel: 'Make a new code',
              });
              if (!ok) return;
              setPairing(await clips.regenerate());
            })();
          }}
        >
          New code
        </button>
        <span className="settings-hint">Use it if the code was shared by mistake.</span>
      </div>
      <p className="settings-hint">
        Clips arrive while this app is open and wait in the clip inbox; ones aimed at the open board
        add themselves. Nothing leaves this computer. To have clips reach your boards on every
        device, including your phone, sign in with a sync plan and use an API token instead.
      </p>
    </section>
  );
}
