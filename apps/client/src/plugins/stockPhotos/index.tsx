import './style.css';
import { StockDialog } from './StockDialog';
import { StockIcon } from '../../components/icons';
import { loadStockKeys, saveStockKey, STOCK_SOURCES } from './stock';
import { stockBoardTools } from './boardTools';
import { useSessionStore } from '../../state/sessionStore';
import { registerPlugin } from '../registry';
import { usePluginSettings } from '../settingsStore';
import { SecretInput, SettingsField, SettingsGroup } from '../../components/ui/SettingsForm';

function StockSettingsPanel() {
  // Subscribe so the inputs reflect synced updates immediately.
  usePluginSettings((s) => s.settings['stock-photos']);
  const keys = loadStockKeys();
  return (
    <div className="plugin-settings-fields">
      <p className="settings-hint">
        Free API keys unlock the keyed sources; Wikimedia Commons needs none. Keys are stored on
        this device and included in encrypted settings sync when you're signed in.
      </p>
      <SettingsGroup title="API keys">
        {STOCK_SOURCES.filter((s) => s.needsKey).map((s) => (
          <SettingsField key={s.id} label={s.label} hint={s.keyHint}>
            <SecretInput
              value={keys[s.id] ?? ''}
              ariaLabel={`${s.label} key`}
              testId={`stock-key-${s.id}`}
              onChange={(v) => saveStockKey(s.id, v)}
            />
          </SettingsField>
        ))}
      </SettingsGroup>
    </div>
  );
}

/** Stock photo/video search (Unsplash, Pexels, Pixabay, Wikimedia, Openverse). */
registerPlugin({
  manifest: {
    id: 'stock-photos',
    order: 10,
    name: 'Stock Media',
    description:
      'Search and import stock photos and videos from Unsplash, Pexels, Pixabay, Wikimedia Commons and Openverse — and give the board assistant a real photo source (search_stock_photos, create_moodboard).',
  },
  tools: stockBoardTools,
  addMenu: [
    {
      label: 'Add Stock Media',
      category: 'media',
      icon: <StockIcon />,
      onSelect: () => useSessionStore.getState().setStockOpen(true),
    },
  ],
  Component: StockDialog,
  SettingsPanel: StockSettingsPanel,
});
