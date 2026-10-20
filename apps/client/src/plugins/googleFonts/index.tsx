import './style.css';
import { GoogleFontsDialog } from './GoogleFontsDialog';
import { TypeIcon } from '../../components/icons';
import { useSessionStore } from '../../state/sessionStore';
import { registerPlugin } from '../registry';

/** Google Fonts search + import as font items. */
registerPlugin({
  manifest: {
    id: 'google-fonts',
    order: 40,
    name: 'Google Fonts',
    description: 'Search Google Fonts and import families as font specimens on the board.',
  },
  addMenu: [
    {
      label: 'Add Google Font',
      category: 'misc',
      icon: <TypeIcon />,
      onSelect: () => useSessionStore.getState().setGoogleFontsOpen(true),
    },
  ],
  Component: GoogleFontsDialog,
});
