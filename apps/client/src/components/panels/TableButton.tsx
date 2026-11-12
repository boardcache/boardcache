import { useRef, useState } from 'react';
import { TableIcon } from '../icons';
import { UiPopover, UiPopoverContent, UiPopoverTrigger } from '../ui/Popover';
import { getActiveEditor, type ActiveEditor } from '../../lib/text/mdEditorRegistry';
import { editTable, insertTable, tableAt, tidyTable, type TableEdit } from '../../lib/text/mdTable';
import type { EditAction } from '../../lib/text/mdFormat';

const COLS = 8;
const ROWS = 6;

const ACTIONS: { id: TableEdit | 'tidy'; label: string }[] = [
  { id: 'tidy', label: 'Tidy the table' },
  { id: 'rowBelow', label: 'Row below' },
  { id: 'rowAbove', label: 'Row above' },
  { id: 'colRight', label: 'Column to the right' },
  { id: 'colLeft', label: 'Column to the left' },
  { id: 'alignLeft', label: 'Align column left' },
  { id: 'alignCenter', label: 'Align column centre' },
  { id: 'alignRight', label: 'Align column right' },
  { id: 'deleteRow', label: 'Delete row' },
  { id: 'deleteCol', label: 'Delete column' },
];

/**
 * The toolbar's Table button. Outside a table it opens a grid: sweep to
 * the size you want and click, and a table of that size lands at the
 * caret. Inside a table it offers the table's edits: tidy the pipes, rows
 * and columns in and out, a column's alignment. The editor it was opened
 * for is remembered, since the panel takes the focus.
 */
export function TableButton({ disabled }: { disabled?: boolean | undefined }) {
  const [open, setOpen] = useState(false);
  const [inTable, setInTable] = useState(false);
  const [hover, setHover] = useState<{ c: number; r: number } | null>(null);
  const target = useRef<ActiveEditor | null>(null);

  const run = (action: EditAction) => {
    target.current?.apply(action);
    setOpen(false);
  };

  return (
    <UiPopover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          target.current = getActiveEditor();
          const s = target.current?.read() ?? null;
          setInTable(!!s && tableAt(s.value, s.selStart) !== null);
          setHover(null);
        }
        setOpen(next);
      }}
    >
      <UiPopoverTrigger asChild>
        <button
          type="button"
          title="Table"
          aria-label="Table"
          disabled={disabled}
          data-testid="md-table"
          onMouseDown={(e) => e.preventDefault()}
        >
          <TableIcon size={15} />
        </button>
      </UiPopoverTrigger>
      <UiPopoverContent className="menu-panel md-table-pop" align="start" keepFocus>
        {inTable ? (
          <div className="md-table-actions" data-testid="md-table-actions">
            {ACTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                className="md-table-action"
                data-testid={`md-table-${a.id}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(a.id === 'tidy' ? tidyTable : editTable(a.id))}
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="md-table-grid-wrap" data-testid="md-table-grid">
            <div
              className="md-table-grid"
              role="grid"
              onMouseLeave={() => setHover(null)}
              style={{ gridTemplateColumns: `repeat(${COLS}, 18px)` }}
            >
              {Array.from({ length: ROWS * COLS }, (_, i) => {
                const c = (i % COLS) + 1;
                const r = Math.floor(i / COLS) + 1;
                const lit = !!hover && c <= hover.c && r <= hover.r;
                return (
                  <button
                    key={i}
                    type="button"
                    role="gridcell"
                    className={`md-table-cell${lit ? ' lit' : ''}`}
                    aria-label={`${c} by ${r}`}
                    data-testid={`md-table-cell-${c}x${r}`}
                    onMouseEnter={() => setHover({ c, r })}
                    onFocus={() => setHover({ c, r })}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => run(insertTable(c, r))}
                  />
                );
              })}
            </div>
            <div className="md-table-size" data-testid="md-table-size">
              {hover ? `${hover.c} × ${hover.r}` : 'Columns × rows'}
            </div>
          </div>
        )}
      </UiPopoverContent>
    </UiPopover>
  );
}
