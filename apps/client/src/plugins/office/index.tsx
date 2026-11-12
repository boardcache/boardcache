import type { Point } from '../../lib/canvas/coords';
import { FileTextIcon } from '../../components/icons';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { createHtmlEmbed } from '../../lib/import/createItems';
import { putAsset } from '../../lib/board/assetStore';
import { updateItems } from '../../state/commands';
import { importFiles } from '../../lib/import/importFiles';
import { useSessionStore } from '../../state/sessionStore';
import { OFFICE_ACCEPT, OFFICE_EXTENSIONS, officeToHtml } from './officeConvert';
import { renderOfficePoster } from './officePoster';
import { registerPlugin } from '../registry';

/**
 * Office Documents: embed Word docs and spreadsheets on the canvas, converted
 * to HTML entirely in the browser (offline, no server). Each file becomes a
 * generic htmlembed item — a live, scrollable document box — with a poster
 * of its first screen for the card, the zoomed-out sprite and exports.
 *
 * The plugin claims its file types (see registry fileImports), so a drop on
 * the canvas, the Add menu's picker and a share from the OS all land here,
 * behind the app's progress overlay while the conversion runs.
 */

const STACK = 40;
const WIDTH = 560;
const HEIGHT = 720;

async function embedOfficeFile(file: File, at: Point): Promise<void> {
  const html = await officeToHtml(file);
  const id = await createHtmlEmbed(at, { html, title: file.name, width: WIDTH, height: HEIGHT });
  // The document is on the canvas; its poster follows when the raster is
  // ready (the first one also loads the rasteriser), and the zoomed-out
  // sprite repaints with it.
  void attachPoster(id, html);
}

async function attachPoster(id: string, html: string): Promise<void> {
  const poster = await renderOfficePoster(html, WIDTH, HEIGHT);
  if (!poster) return;
  const posterAssetId = await putAsset(poster);
  updateItems([id], 'Document preview', (it) => {
    if (it.type === 'htmlembed') it.posterAssetId = posterAssetId;
  });
}

async function importOfficeFiles(files: File[], at: Point): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    await embedOfficeFile(files[i]!, { x: at.x + i * STACK, y: at.y + i * STACK });
  }
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
    if (!files.length) return;
    const center = clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
    void importFiles(files, center);
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
  fileImports: [{ extensions: OFFICE_EXTENSIONS, importFiles: importOfficeFiles }],
});
