import DOMPurify from 'dompurify';
import './style.css';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { ChartIcon } from '../../components/icons';
import { UiDialog } from '../../components/ui/Dialog';
import { getAssetBlob, putAsset } from '../../lib/board/assetStore';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { importImageFiles } from '../../lib/import/importImages';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { CHART_TYPES, parseChartConfig, renderChartSvg } from './chartGen';
import type { ChartConfig } from './chartGen';
import { registerPlugin } from '../registry';

/**
 * Charts plugin: a config dialog compiles simple line/area/bar/scatter/pie
 * charts to standalone SVG images (config embedded for later editing). The
 * board only ever sees a normal vector image asset.
 */

interface ChartDialogState {
  /** null = closed; editItemId set = editing an existing chart item. */
  open: { editItemId: string | null; initial: ChartConfig } | null;
  openNew: () => void;
  openEdit: (itemId: string, config: ChartConfig) => void;
  close: () => void;
}

const SAMPLE: ChartConfig = {
  type: 'bar',
  title: '',
  columns: ['Month', 'Views'],
  rows: [
    ['Jan', '120'],
    ['Feb', '180'],
    ['Mar', '150'],
    ['Apr', '240'],
  ],
};

const useChartDialog = create<ChartDialogState>((set) => ({
  open: null,
  openNew: () => set({ open: { editItemId: null, initial: structuredClone(SAMPLE) } }),
  openEdit: (editItemId, initial) => set({ open: { editItemId, initial } }),
  close: () => set({ open: null }),
}));

/** The selected item, when it's a single chart SVG we can edit. */
async function selectedChart(): Promise<{ itemId: string; config: ChartConfig } | null> {
  // The Add menu deselects on open (chrome behavior) — fall back to what it
  // just cleared so "Insert Chart" still edits the selected chart.
  const session = useSessionStore.getState();
  const selection = session.selection.length ? session.selection : session.chromeClearedSelection;
  if (selection.length !== 1) return null;
  const item = useDocumentStore.getState().doc.items[selection[0]!];
  if (!item || item.type !== 'image') return null;
  const blob = await getAssetBlob(item.assetId);
  if (!blob || blob.type !== 'image/svg+xml') return null;
  const config = parseChartConfig(await blob.text());
  return config ? { itemId: item.id, config } : null;
}

function ChartDialog() {
  const open = useChartDialog((s) => s.open);
  return open ? <ChartDialogBody key={open.editItemId ?? 'new'} /> : null;
}

function ChartDialogBody() {
  const { editItemId, initial } = useChartDialog.getState().open!;
  const close = () => useChartDialog.getState().close();
  const [config, setConfig] = useState<ChartConfig>(initial);
  const [svg, setSvg] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  // Live preview, debounced.
  useEffect(() => {
    const timer = setTimeout(() => {
      void renderChartSvg(config)
        .then(setSvg)
        .catch(() => setSvg(''));
    }, 250);
    return () => clearTimeout(timer);
  }, [config]);

  useEffect(() => {
    if (previewRef.current)
      previewRef.current.innerHTML = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['script', 'foreignObject'],
      });
  }, [svg]);

  const set = (patch: Partial<ChartConfig>) => setConfig((c) => ({ ...c, ...patch }));
  const setCell = (r: number, c: number, value: string) =>
    setConfig((cfg) => {
      const rows = cfg.rows.map((row) => [...row]);
      rows[r]![c] = value;
      return { ...cfg, rows };
    });
  const setColumn = (c: number, value: string) =>
    setConfig((cfg) => {
      const columns = [...cfg.columns];
      columns[c] = value;
      return { ...cfg, columns };
    });

  const pasteCsv = async () => {
    const text = await navigator.clipboard
      .readText()
      .catch(() => window.prompt('Paste CSV (first row = column names):') ?? '');
    if (!text.trim()) return;
    const rows = text
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(/[\t,;]/).map((cell) => cell.trim()));
    if (rows.length < 2 || rows[0]!.length < 2) {
      window.alert('CSV needs a header row and at least one data row (2+ columns).');
      return;
    }
    set({ columns: rows[0]!, rows: rows.slice(1) });
  };

  const apply = async () => {
    setBusy(true);
    try {
      const source = await renderChartSvg(config);
      const name = `${config.title.trim() || 'Chart'}.svg`;
      if (editItemId) {
        const assetId = await putAsset(new Blob([source], { type: 'image/svg+xml' }));
        updateItems([editItemId], 'Edit chart', (d) => {
          if (d.type !== 'image') return;
          d.assetId = assetId;
          delete d.previewAssetId;
          d.name = name;
        });
      } else {
        const file = new File([source], name, { type: 'image/svg+xml' });
        await importImageFiles(
          [file],
          clientToCanvas(window.innerWidth / 2, window.innerHeight / 2),
        );
      }
      close();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Chart rendering failed.');
    } finally {
      setBusy(false);
    }
  };

  const isPie = config.type === 'pie';

  return (
    <UiDialog
      title={editItemId ? 'Edit Chart' : 'New Chart'}
      onClose={close}
      className="chart-sheet"
      testId="chart-dialog"
    >
      <div className="chart-body">
        <div className="chart-controls">
          <div className="chart-types" role="group" aria-label="Chart type">
            {CHART_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={config.type === t.id ? 'active' : ''}
                aria-pressed={config.type === t.id}
                data-testid={`chart-type-${t.id}`}
                onClick={() => set({ type: t.id })}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            className="chart-title"
            value={config.title}
            placeholder="Title (optional)"
            data-testid="chart-title"
            onChange={(e) => set({ title: e.target.value })}
          />

          <div className="chart-table" data-testid="chart-table">
            <div className="chart-row chart-row-head">
              {config.columns.map((col, c) => (
                <input
                  key={c}
                  value={col}
                  data-testid={`chart-col-${c}`}
                  onChange={(e) => setColumn(c, e.target.value)}
                />
              ))}
            </div>
            {config.rows.map((row, r) => (
              <div className="chart-row" key={r}>
                {config.columns.map((_, c) => (
                  <input
                    key={c}
                    value={row[c] ?? ''}
                    data-testid={`chart-cell-${r}-${c}`}
                    onChange={(e) => setCell(r, c, e.target.value)}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="chart-table-actions">
            <button
              type="button"
              onClick={() => set({ rows: [...config.rows, config.columns.map(() => '')] })}
              data-testid="chart-add-row"
            >
              + Row
            </button>
            <button
              type="button"
              disabled={isPie}
              title={isPie ? 'Pie charts use one value column' : undefined}
              onClick={() =>
                set({
                  columns: [...config.columns, `Series ${config.columns.length}`],
                  rows: config.rows.map((row) => [...row, '']),
                })
              }
              data-testid="chart-add-col"
            >
              + Series
            </button>
            <button type="button" onClick={() => void pasteCsv()} data-testid="chart-paste-csv">
              Paste CSV
            </button>
          </div>

          <div className="chart-actions">
            <button
              type="button"
              className="sync-primary"
              disabled={busy}
              onClick={() => void apply()}
              data-testid="chart-apply"
            >
              {busy ? 'Rendering' : editItemId ? 'Save Chart' : 'Add to Board'}
            </button>
          </div>
        </div>
        <div className="chart-preview" ref={previewRef} data-testid="chart-preview" />
      </div>
    </UiDialog>
  );
}

import { z } from 'zod';

const chartToolSchema = z.object({
  type: z.enum(['line', 'area', 'bar', 'scatter', 'pie']),
  title: z.string().default(''),
  columns: z.array(z.string()).min(2).describe('First column = X axis/category, rest = series'),
  rows: z.array(z.array(z.string())).min(1).describe('Row-major cells, matching columns'),
  x: z.number().optional(),
  y: z.number().optional(),
});

registerPlugin({
  manifest: {
    id: 'charts',
    order: 50,
    name: 'Charts',
    description:
      'Build simple line, area, bar, scatter and pie charts as crisp vector images — editable later.',
  },
  addMenu: [
    {
      label: 'Insert Chart',
      category: 'structure',
      icon: <ChartIcon />,
      onSelect: () => {
        // Editing: invoked with a single chart image selected re-opens it.
        void selectedChart().then((hit) => {
          if (hit) useChartDialog.getState().openEdit(hit.itemId, hit.config);
          else useChartDialog.getState().openNew();
        });
      },
    },
  ],
  Component: ChartDialog,
  tools: [
    {
      name: 'insert_chart',
      description:
        'Create a chart (line, area, bar, scatter or pie) from tabular data and place it on the board as a crisp vector image. First column is the X axis/category; additional columns are series.',
      parameters: chartToolSchema,
      access: 'write',
      execute: async (args, ctx) => {
        const config = {
          type: args.type,
          title: args.title,
          columns: args.columns,
          rows: args.rows,
        };
        const source = await renderChartSvg(config);
        const file = new File([source], `${args.title.trim() || 'Chart'}.svg`, {
          type: 'image/svg+xml',
        });
        const center = ctx.viewCenter();
        const at = { x: args.x ?? center.x, y: args.y ?? center.y };
        const ids = await importImageFiles([file], at);
        return { id: ids[0] };
      },
    },
  ],
});
