import { FileTextIcon } from '../../components/icons';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { createHtmlEmbed } from '../../lib/import/createItems';
import { useSessionStore } from '../../state/sessionStore';
import { OFFICE_ACCEPT, officeToHtml } from './officeConvert';
import { registerPlugin } from '../registry';

/**
 * Office Documents: embed Word docs and spreadsheets on the canvas, converted
 * to HTML entirely in the browser (offline, no server). Each file becomes a
 * generic htmlembed item — a live, scrollable document box.
 */

const STACK = 40;

async function embedOfficeFile(file: File, index: number): Promise<void> {
  const html = await officeToHtml(file);
  const center = clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
  await createHtmlEmbed(
    { x: center.x + index * STACK, y: center.y + index * STACK },
    { html, title: file.name },
  );
}

function pickAndEmbed(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = OFFICE_ACCEPT;
  input.multiple = true;
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    input.remove();
    void (async () => {
      for (let i = 0; i < files.length; i++) {
        try {
          await embedOfficeFile(files[i]!, i);
        } catch (err) {
          window.alert(err instanceof Error ? err.message : `Couldn’t embed ${files[i]!.name}.`);
        }
      }
    })();
  });
  input.click();
}

registerPlugin({
  manifest: {
    id: 'office',
    order: 80,
    name: 'Office Documents',
    description:
      'Embed Word docs (.docx) and spreadsheets (.xlsx/.xls/.ods/.csv) on the canvas as live document boxes — converted entirely offline in the browser.',
  },
  addMenu: [
    {
      label: 'Embed Office Document',
      category: 'documents',
      icon: <FileTextIcon />,
      onSelect: () => {
        // Ensure we're on the canvas so the embed lands somewhere visible.
        useSessionStore.getState().setView('canvas');
        pickAndEmbed();
      },
    },
  ],
});
