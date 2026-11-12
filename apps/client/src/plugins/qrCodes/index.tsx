import { QrIcon } from '../../components/icons';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { createQrItem } from '../../lib/import/createItems';
import { registerPlugin } from '../registry';
import { promptText } from '../../components/ui/Prompt';

/** QR code generator: prompt for text/URL, place a vector QR item. */
registerPlugin({
  manifest: {
    id: 'qr-codes',
    order: 20,
    name: 'QR Codes',
    description: 'Generate scannable QR codes from text or URLs as vector canvas items.',
  },
  addMenu: [
    {
      label: 'Generate QR Code',
      category: 'links',
      icon: <QrIcon />,
      onSelect: () =>
        void promptText({ title: 'Generate QR code', label: 'Text or URL' }).then((input) => {
          if (input === null || !input.trim()) return;
          createQrItem(clientToCanvas(window.innerWidth / 2, window.innerHeight / 2), input.trim());
        }),
    },
  ],
});
