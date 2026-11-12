import { useEffect, useState, type CSSProperties } from 'react';
import { LockIcon } from '../icons';
import { SettingsField, SettingsGroup } from '../ui/SettingsForm';
import {
  agentFolderRows,
  folderSubtreeKeys,
  useAgentPrivacy,
  type LibrarySearchScope,
} from '../../lib/agentPrivacy';
import { useProposals } from '../../lib/agentProposals';
import { loadLibraryMeta, onLibraryMetaChanged } from '../../lib/board/libraryMeta';
import type { LibraryMeta } from '../../lib/board/libraryMeta';
import { pendingUsageTally, setUsageTallyEnabled, usageTallyEnabled } from '../../lib/usageTally';
import { useVaultStore } from '../../lib/vault/vaultStore';

/**
 * Settings → Privacy: what leaves this device beyond the board a person is
 * working on. Agents (the in-app assistant and outside agents over MCP) see
 * what the tools they call return, and so does the provider running them;
 * the choices here say how far those tools reach. The anonymous feature
 * counts live here too.
 */
export function PrivacyPanel() {
  const prefs = useAgentPrivacy((s) => s.prefs);
  const set = useAgentPrivacy((s) => s.set);
  const [meta, setMeta] = useState<LibraryMeta | null>(null);
  const root = useVaultStore((s) => s.root);
  const dirs = useVaultStore((s) => s.dirs);
  useEffect(() => {
    let on = true;
    const load = () =>
      void loadLibraryMeta()
        .then((m) => {
          if (on) setMeta(m);
        })
        .catch(() => undefined);
    load();
    const off = onLibraryMetaChanged(load);
    return () => {
      on = false;
      off();
    };
  }, []);
  const files = root ? dirs : null;
  const rows = meta ? agentFolderRows(meta, files) : [];
  const chosen = new Set(prefs.chosenFolders);
  const toggle = (key: string, on: boolean) => {
    if (!meta) return;
    const keys = folderSubtreeKeys(key, meta, files);
    const next = new Set(chosen);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    set({ chosenFolders: [...next] });
  };
  const scope = (value: LibrarySearchScope, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={prefs.librarySearch === value}
      className={prefs.librarySearch === value ? 'active' : ''}
      data-testid={`privacy-search-${value}`}
      onClick={() => set({ librarySearch: value })}
    >
      {label}
    </button>
  );
  const [usageOn, setUsageOn] = useState(usageTallyEnabled);
  const hold = useProposals((s) => s.hold);
  const setHold = useProposals((s) => s.setHold);

  return (
    <section className="settings-section" data-testid="settings-privacy">
      <h3>Privacy</h3>
      <p className="settings-hint">
        Agents see what the tools you let them call return: the in-app assistant and any outside
        agent connected to this app, and the provider running them. These choices say how far those
        tools reach beyond the board you point them at.
      </p>

      <SettingsGroup
        title="Library search"
        hint="search_library lets an agent look through your other boards for material. Locked boards and boards in locked folders are never searched."
        testId="privacy-library"
      >
        <SettingsField label="Boards an agent may search" wide>
          <div className="seg" role="radiogroup" aria-label="Boards an agent may search">
            {scope('off', 'None')}
            {scope('all', 'Every unlocked board')}
            {scope('chosen', 'Chosen folders')}
          </div>
        </SettingsField>
        {prefs.librarySearch === 'chosen' && (
          <SettingsField
            label="Folders open to agents"
            hint="Ticking a folder ticks the folders inside it. A folder you never tick stays closed, new ones included."
            wide
          >
            <ul className="settings-folders" data-testid="privacy-folders">
              {rows.map((r) => (
                <li key={r.key} style={{ '--depth': r.depth } as CSSProperties}>
                  <label className="settings-row">
                    <input
                      type="checkbox"
                      checked={!r.locked && chosen.has(r.key)}
                      disabled={r.locked}
                      data-testid={`privacy-folder-${r.key}`}
                      onChange={(e) => toggle(r.key, e.target.checked)}
                    />
                    <span>{r.label}</span>
                    {r.key === 'home' && (
                      <span className="settings-hint">boards not in a folder</span>
                    )}
                    {r.locked && (
                      <span className="settings-hint">
                        <LockIcon size={11} /> locked
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </SettingsField>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Board pictures"
        hint="A picture carries everything in view, photos and embedded pages included, where the text tools carry only words."
        testId="privacy-render"
      >
        <SettingsField
          label="Let agents render a picture of the open board"
          hint="render_board, for checking a layout after building it."
        >
          <input
            type="checkbox"
            checked={prefs.render}
            data-testid="privacy-render-on"
            onChange={(e) => set({ render: e.target.checked })}
          />
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup
        title="Agent changes"
        hint="While an agent edits a board, its changes are marked and held: a bar offers Keep and Undo all, and the board does not sync until you keep them. Your own edits are never held."
        testId="privacy-hold"
      >
        <SettingsField
          label="Hold agent changes for review"
          hint="Off, an agent's changes land as they come, each still one undo step."
        >
          <input
            type="checkbox"
            checked={hold}
            data-testid="privacy-hold-on"
            onChange={(e) => setHold(e.target.checked)}
          />
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup
        title="Help improve boardCache"
        hint="Off by default. When on, the app keeps a tally of which features you use (an image added, a dossier exported, the gallery opened) and sends the counts to boardCache once a day. Never board content, names, text or prompts; keyed by a random id that is not your account."
        testId="privacy-usage"
      >
        <SettingsField
          label="Send anonymous feature counts"
          hint={
            usageOn
              ? (() => {
                  const t = Object.entries(pendingUsageTally());
                  return t.length
                    ? `Waiting to send: ${t.map(([k, v]) => `${k} ×${v}`).join(', ')}.`
                    : 'Nothing waiting to send yet.';
                })()
              : undefined
          }
        >
          <input
            type="checkbox"
            checked={usageOn}
            onChange={(e) => {
              setUsageTallyEnabled(e.target.checked);
              setUsageOn(e.target.checked);
            }}
            data-testid="settings-usage-tally"
          />
        </SettingsField>
      </SettingsGroup>
    </section>
  );
}
