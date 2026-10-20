import { ScanLineIcon } from '../../components/icons';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { importMediaFiles } from '../../lib/import/importMedia';
import { scanDocument } from '../../lib/iosNative';
import { isNativeShell } from '../../lib/mobile';
import { showNotice } from '../../lib/notices';
import { registerPlugin } from '../registry';

/**
 * What the iPhone and iPad app adds on top of the web client. Its menu
 * entries only appear inside the shell; elsewhere the plugin is inert.
 */
registerPlugin({
  manifest: {
    id: 'mobile-native',
    order: 96,
    name: 'Phone & tablet',
    description:
      'Native touches in the iPhone, iPad and Android apps: scan documents with the camera, read text on the device, biometric unlock, the share sheet and widgets.',
    // On by itself inside the shell, absent everywhere else: not a choice.
    platform: isNativeShell,
  },
  addMenu: [
    {
      label: 'Scan Document',
      category: 'documents',
      icon: <ScanLineIcon />,
      when: isNativeShell,
      onSelect: () => {
        void (async () => {
          try {
            const pages = await scanDocument();
            if (pages.length === 0) return;
            await importMediaFiles(
              pages,
              clientToCanvas(window.innerWidth / 2, window.innerHeight / 2),
            );
          } catch {
            showNotice('The scanner didn’t return any pages.');
          }
        })();
      },
    },
  ],
});
