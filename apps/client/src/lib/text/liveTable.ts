import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { StateField, type EditorState } from '@codemirror/state';
import type { EditState } from './mdFormat';
import {
  cellAt,
  editTable,
  findTables,
  renderTable,
  tableAt,
  tableGrid,
  tableNextCell,
  type TableBlock,
} from './mdTable';

/**
 * Tables in the live editor: each Markdown table is shown as a real table
 * whose cells are fields you type into, in place of its source lines. A
 * cell's text goes back into the Markdown when you leave the cell (Tab,
 * Enter, an arrow out, a click elsewhere), as one change the undo stack
 * takes as one step; the source, the canvas, the lightbox and a team room
 * all see ordinary Markdown. Tab and Shift+Tab walk the cells (a new row
 * past the last), Enter adds a row below, the arrows leave at the edges.
 * The toolbar's Table button acts on the cell you are in.
 */

/** The cell that has the focus, so toolbar edits know where they apply. */
let focused: { view: EditorView; input: HTMLInputElement } | null = null;

const KEY_FROM = 'from';

function tableOfDom(view: EditorView, dom: HTMLElement): TableBlock | null {
  const from = Number(dom.dataset[KEY_FROM]);
  if (!Number.isFinite(from)) return null;
  const table = tableAt(view.state.doc.toString(), from);
  return table && table.from === from ? table : null;
}

function cellInputs(dom: HTMLElement): HTMLInputElement[] {
  return [...dom.querySelectorAll<HTMLInputElement>('input.cm-live-table-cell')];
}

function cellOf(input: HTMLInputElement): { row: number; col: number } {
  return { row: Number(input.dataset['row']), col: Number(input.dataset['col']) };
}

/** The grid as the fields hold it right now (typing not yet committed). */
function gridFromDom(dom: HTMLElement, table: TableBlock, value: string): string[][] {
  const grid = tableGrid(value, table);
  for (const input of cellInputs(dom)) {
    const { row, col } = cellOf(input);
    if (grid[row]) grid[row]![col] = input.value;
  }
  return grid;
}

function sizeInput(input: HTMLInputElement): void {
  input.style.width = `${Math.max(3, input.value.length + 1)}ch`;
}

/** Focus the field of the cell holding `pos`, selecting its text. */
export function focusTableCellAt(view: EditorView, pos: number): boolean {
  const table = tableAt(view.state.doc.toString(), pos);
  if (!table) return false;
  const dom = view.contentDOM.querySelector<HTMLElement>(
    `.cm-live-table[data-from="${table.from}"]`,
  );
  if (!dom) return false;
  const { row, col } = cellAt(table, pos);
  const input = cellInputs(dom).find((i) => {
    const c = cellOf(i);
    return c.row === row && c.col === col;
  });
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}

/** When a cell has the focus: the text, with the caret in that cell's
 *  source, so the shared edit actions find the right table and cell. */
export function tableCellState(view: EditorView): EditState | null {
  if (!focused || focused.view !== view || !focused.input.isConnected) return null;
  const dom = focused.input.closest<HTMLElement>('.cm-live-table');
  const table = dom ? tableOfDom(view, dom) : null;
  if (!table) return null;
  const { row, col } = cellOf(focused.input);
  const cell = table.rows[row]?.cells[col];
  if (!cell) return null;
  const value = view.state.doc.toString();
  return { value, selStart: cell.from, selEnd: cell.from };
}

/**
 * Write the fields back into the source as one change, then run `then` on
 * the result (a move, a row) and land in the cell it names. Nothing is
 * dispatched when nothing changed.
 */
function commit(
  view: EditorView,
  dom: HTMLElement,
  then?: (s: EditState) => EditState | null,
  focusAfter = true,
): void {
  const table = tableOfDom(view, dom);
  if (!table) return;
  const old = view.state.doc.toString();
  const grid = gridFromDom(dom, table, old);
  const active = document.activeElement;
  const at =
    active instanceof HTMLInputElement && dom.contains(active)
      ? cellOf(active)
      : { row: 0, col: 0 };
  const out = renderTable(grid, table.aligns, table.from, at);
  let next: EditState = {
    value: old.slice(0, table.from) + out.text + old.slice(table.to),
    selStart: out.caretFrom,
    selEnd: out.caretFrom,
  };
  if (then) next = then(next) ?? next;
  if (next.value !== old) {
    let p = 0;
    const max = Math.min(old.length, next.value.length);
    while (p < max && old.charCodeAt(p) === next.value.charCodeAt(p)) p++;
    let s = 0;
    while (
      s < max - p &&
      old.charCodeAt(old.length - 1 - s) === next.value.charCodeAt(next.value.length - 1 - s)
    )
      s++;
    view.dispatch({
      changes: { from: p, to: old.length - s, insert: next.value.slice(p, next.value.length - s) },
      selection: { anchor: next.selStart },
    });
  }
  if (focusAfter && then) focusTableCellAt(view, next.selStart);
}

/** Write the focused table's fields into the source before another edit
 *  reads it (a toolbar action), so nothing typed is left behind. */
export function commitTableFields(view: EditorView): void {
  if (!focused || focused.view !== view || !focused.input.isConnected) return;
  const dom = focused.input.closest<HTMLElement>('.cm-live-table');
  if (dom) commit(view, dom, undefined, false);
}

/** Leave the table for the editor's own caret at `pos`. */
function leaveTo(view: EditorView, dom: HTMLElement, pos: (table: TableBlock) => number): void {
  const table = tableOfDom(view, dom);
  if (!table) return;
  commit(view, dom, undefined, false);
  const fresh = tableOfDom(view, dom) ?? table;
  const at = Math.max(0, Math.min(view.state.doc.length, pos(fresh)));
  view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
  view.focus();
}

class TableWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly from: number,
    readonly aligns: TableBlock['aligns'],
  ) {
    super();
  }
  override eq(other: TableWidget): boolean {
    return other.text === this.text && other.from === this.from;
  }
  override ignoreEvent(): boolean {
    return true;
  }
  override toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement('div');
    dom.className = 'cm-live-table';
    dom.contentEditable = 'false';
    dom.setAttribute('data-testid', 'live-table');
    this.fill(dom, view);
    return dom;
  }
  /** The same table with other text: patch the fields in place, so a
   *  field you are typing in keeps its focus; a new shape is rebuilt. */
  override updateDOM(dom: HTMLElement, view: EditorView): boolean {
    dom.dataset[KEY_FROM] = String(this.from);
    const table = tableAt(this.text, 0);
    if (!table) return false;
    const grid = tableGrid(this.text, table);
    const inputs = cellInputs(dom);
    const rows = grid.length - 1; // the separator has no fields
    const cols = Math.max(...grid.map((r) => r.length), 1);
    const shapeOk =
      inputs.length === rows * cols &&
      inputs.every((i) => {
        const c = cellOf(i);
        return c.row < grid.length && c.col < cols;
      });
    if (!shapeOk) {
      const active = document.activeElement;
      const keep =
        active instanceof HTMLInputElement && dom.contains(active) ? cellOf(active) : null;
      this.fill(dom, view);
      if (keep) {
        const again = cellInputs(dom).find((i) => {
          const c = cellOf(i);
          return c.row === keep.row && c.col === keep.col;
        });
        again?.focus();
      }
      return true;
    }
    for (const input of inputs) {
      const { row, col } = cellOf(input);
      const text = grid[row]?.[col] ?? '';
      if (input.value !== text && document.activeElement !== input) {
        input.value = text;
        sizeInput(input);
      }
    }
    for (const input of inputs) {
      const { col } = cellOf(input);
      input.style.textAlign = this.aligns[col] ?? '';
    }
    return true;
  }
  private fill(dom: HTMLElement, view: EditorView): void {
    dom.dataset[KEY_FROM] = String(this.from);
    dom.replaceChildren();
    const table = tableAt(this.text, 0);
    if (!table) return;
    const grid = tableGrid(this.text, table);
    const cols = Math.max(...grid.map((r) => r.length), 1);
    const el = document.createElement('table');
    const head = document.createElement('thead');
    const body = document.createElement('tbody');
    grid.forEach((cells, row) => {
      if (row === 1) return;
      const tr = document.createElement('tr');
      for (let col = 0; col < cols; col++) {
        const td = document.createElement(row === 0 ? 'th' : 'td');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cm-live-table-cell';
        input.value = cells[col] ?? '';
        input.dataset['row'] = String(row);
        input.dataset['col'] = String(col);
        input.setAttribute(
          'aria-label',
          `Row ${row === 0 ? 'header' : row - 1}, column ${col + 1}`,
        );
        input.style.textAlign = this.aligns[col] ?? '';
        input.spellcheck = false;
        sizeInput(input);
        this.wire(input, dom, view);
        td.appendChild(input);
        tr.appendChild(td);
      }
      (row === 0 ? head : body).appendChild(tr);
    });
    el.append(head, body);
    dom.appendChild(el);
  }
  private wire(input: HTMLInputElement, dom: HTMLElement, view: EditorView): void {
    input.addEventListener('input', () => sizeInput(input));
    input.addEventListener('focus', () => {
      focused = { view, input };
    });
    input.addEventListener('blur', () => {
      // A move inside the table commits on its own; a click elsewhere lands here.
      setTimeout(() => {
        if (!input.isConnected || document.activeElement === input) return;
        const still = document.activeElement;
        if (still instanceof HTMLInputElement && dom.contains(still)) return;
        if (focused?.input === input) focused = null;
        commit(view, dom, undefined, false);
      }, 0);
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // the app's shortcuts stay out of a cell
      const { row, col } = cellOf(input);
      const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
      const atEnd =
        input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
      if (e.key === 'Tab') {
        e.preventDefault();
        commit(view, dom, (s) => tableNextCell(s, e.shiftKey));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        commit(view, dom, (s) => editTable('rowBelow')(s));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        leaveTo(view, dom, (t) => t.to);
      } else if (e.key === 'ArrowUp' && (row === 0 || row === 2)) {
        e.preventDefault();
        if (row === 0) leaveTo(view, dom, (t) => Math.max(0, t.from - 1));
        else commit(view, dom, (s) => moveTo(s, 0, col));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        commit(view, dom, (s) => moveTo(s, row - 1, col));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const table = tableOfDom(view, dom);
        const last = table ? table.rows.length - 1 : row;
        if (row >= last) leaveTo(view, dom, (t) => t.to + 1);
        else commit(view, dom, (s) => moveTo(s, row === 0 ? 2 : row + 1, col));
      } else if (e.key === 'ArrowLeft' && atStart && (col > 0 || row > 0)) {
        e.preventDefault();
        commit(view, dom, (s) => tableNextCell(s, true));
      } else if (e.key === 'ArrowRight' && atEnd) {
        const table = tableOfDom(view, dom);
        const cols = table ? Math.max(...table.rows.map((r) => r.cells.length), 1) : 1;
        const last = table ? table.rows.length - 1 : row;
        if (col < cols - 1 || row < last) {
          e.preventDefault();
          commit(view, dom, (s) => tableNextCell(s, false));
        }
      }
    });
  }
}

/** The state with the caret in a given cell of the table at `s.selStart`. */
function moveTo(s: EditState, row: number, col: number): EditState | null {
  const table = tableAt(s.value, s.selStart);
  const cell = table?.rows[row]?.cells[col];
  if (!cell) return null;
  return { value: s.value, selStart: cell.from, selEnd: cell.from };
}

function tableDecorations(state: EditorState): DecorationSet {
  const value = state.doc.toString();
  const decos = findTables(value).map((t) =>
    Decoration.replace({
      widget: new TableWidget(value.slice(t.from, t.to), t.from, t.aligns),
      block: true,
    }).range(t.from, t.to),
  );
  return decos.length ? Decoration.set(decos, true) : Decoration.none;
}

/** Block replacements, which only a state field may provide. */
export const tableFold = StateField.define<DecorationSet>({
  create: (state) => tableDecorations(state),
  update: (value, tr) => (tr.docChanged ? tableDecorations(tr.state) : value),
  provide: (f) => EditorView.decorations.from(f),
});

/** The spans the tables cover, so the inline decorator leaves them alone. */
export function tableSpans(state: EditorState): { from: number; to: number }[] {
  return findTables(state.doc.toString()).map((t) => ({ from: t.from, to: t.to }));
}

/** ArrowDown/ArrowUp from the line beside a table: into its nearest cell. */
export function enterTableFrom(view: EditorView, down: boolean): boolean {
  const { doc, selection } = view.state;
  if (!selection.main.empty) return false;
  const line = doc.lineAt(selection.main.head);
  const n = down ? line.number + 1 : line.number - 1;
  if (n < 1 || n > doc.lines) return false;
  const target = doc.line(n);
  const table = tableAt(doc.toString(), target.from);
  if (!table) return false;
  const row = down ? table.rows[0]! : table.rows[table.rows.length - 1]!;
  const cell = row.cells[0];
  return !!cell && focusTableCellAt(view, cell.from);
}
