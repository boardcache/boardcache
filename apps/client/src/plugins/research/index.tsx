import { registerPlugin } from '../registry';
import { usePluginSettings } from '../settingsStore';
import { PLUGIN_ID, PROVIDERS, loadKeys, loadMailto, saveKey, saveMailto } from './providers';
import { researchTools } from './tools';
import { platform } from '../../lib/platform';
import {
  SecretInput,
  SettingsBadge,
  SettingsField,
  SettingsGroup,
  SettingsInput,
  SettingsLink,
  SettingsNote,
} from '../../components/ui/SettingsForm';

const KIND_LABEL = {
  web: 'Web search',
  news: 'News',
  papers: 'Papers',
  collections: 'Collections',
  books: 'Books',
  social: 'Social',
} as const;

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function ResearchSettingsPanel() {
  usePluginSettings((s) => s.settings[PLUGIN_ID]);
  const keys = loadKeys();
  const desktop = platform.hasHttpBridge;
  const kinds = Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[];
  return (
    <div className="plugin-settings-fields">
      <p className="settings-hint">
        Sources for the research tools. Keyless sources work as they are; a key unlocks the rest.
        Keys stay on this device and travel in encrypted settings sync when you are signed in.
        {desktop
          ? ''
          : ' Sources marked Desktop app need the desktop app, because their APIs refuse calls from a browser.'}
      </p>
      {kinds.map((kind) => (
        <SettingsGroup key={kind} title={KIND_LABEL[kind]}>
          {PROVIDERS.filter((p) => p.kind === kind).map((p) => (
            <SettingsField
              key={p.id}
              label={p.label}
              badges={
                <>
                  {!p.corsSafe && !desktop ? <SettingsBadge>Desktop app</SettingsBadge> : null}
                  {p.keyHint && !p.needsKey ? <SettingsBadge>Key optional</SettingsBadge> : null}
                </>
              }
              hint={
                <>
                  {p.blurb}
                  {p.keyUrl ? (
                    <>
                      {' '}
                      <SettingsLink href={p.keyUrl}>Get a key</SettingsLink>
                    </>
                  ) : null}
                </>
              }
            >
              {p.keyHint ? (
                <SecretInput
                  value={keys[p.id] ?? ''}
                  placeholder={cap(p.keyHint)}
                  ariaLabel={`${p.label} key`}
                  testId={`research-key-${p.id}`}
                  onChange={(v) => saveKey(p.id, v)}
                />
              ) : (
                <SettingsNote>No key needed</SettingsNote>
              )}
            </SettingsField>
          ))}
          {kind === 'papers' ? (
            <SettingsField
              label="Contact email"
              hint="Optional. OpenAlex and CrossRef serve a named caller faster."
            >
              <SettingsInput
                type="email"
                value={loadMailto()}
                placeholder="you@example.com"
                testId="research-mailto"
                onChange={(e) => saveMailto(e.target.value)}
              />
            </SettingsField>
          ) : null}
        </SettingsGroup>
      ))}
    </div>
  );
}

/** Research sources for agents: web, news, papers, collections, books, social. */
registerPlugin({
  manifest: {
    id: PLUGIN_ID,
    order: 12,
    name: 'Research',
    description:
      'Give the board assistant and outside agents real sources to search: the web (Perplexity, Brave, Tavily), news (The Guardian, The New York Times, GDELT), papers (OpenAlex, Semantic Scholar, CrossRef, arXiv, PubMed), collections (Smithsonian, Europeana, The Met, Library of Congress, Trove), books (Google Books, Internet Archive, Open Library) and social (X, Bluesky, Reddit). Keyless sources work out of the box; add keys for the rest.',
  },
  tools: researchTools,
  SettingsPanel: ResearchSettingsPanel,
});
