import type { EditAction, EditState } from './mdFormat';

/**
 * Markdown (GFM) tables as the editors see them: insert one, find the one
 * under the caret, move between its cells, add and remove rows and columns,
 * and tidy it so the pipes line up. Everything is a whole-text transform
 * like the other edit actions, so every editor gets the same behaviour.
 */

interface TableCell {
  /** Offset of the cell's first character (after the pipe and one space). */
  from: number;
  /** Offset just past the cell's content. */
  to: number;
}

interface TableRow {
  from: number;
  to: number;
  cells: TableCell[];
  /** The `---` row under the header. */
  separator: boolean;
}

export interface TableBlock {
  from: number;
  to: number;
  rows: TableRow[];
  /** Alignment per column from the separator row. */
  aligns: ('left' | 'center' | 'right' | null)[];
}

const SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** Whether a line is part of a table: it has a pipe outside a code span. */
const tableLine = (line: string): boolean => /^\s*\|/.test(line) || /\|\s*$/.test(line);

function splitCells(line: string, lineFrom: number): TableCell[] {
  const cells: TableCell[] = [];
  let i = 0;
  const n = line.length;
  // Leading pipe is optional in GFM; the editors always write it.
  while (i < n && line[i] === ' ') i++;
  if (line[i] === '|') i++;
  let start = i;
  for (; i <= n; i++) {
    const ch = line[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '|' || i === n) {
      if (i === n && start === n && cells.length && line.trimEnd().endsWith('|')) break;
      let a = start;
      let b = i;
      while (a < b && line[a] === ' ') a++;
      while (b > a && line[b - 1] === ' ') b--;
      cells.push({ from: lineFrom + a, to: lineFrom + b });
      start = i + 1;
    }
  }
  return cells;
}

function parseAligns(line: string): TableBlock['aligns'] {
  return line
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s.startsWith(':') && s.endsWith(':')
        ? 'center'
        : s.endsWith(':')
          ? 'right'
          : s.startsWith(':')
            ? 'left'
            : null,
    );
}

/** The table whose lines surround `caret`, or null when the caret is not in one. */
export function tableAt(value: string, caret: number): TableBlock | null {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const nextNl = value.indexOf('\n', caret);
  const line = value.slice(lineStart, nextNl === -1 ? value.length : nextNl);
  if (!tableLine(line)) return null;
  // Walk out to the block's edges.
  let from = lineStart;
  while (from > 0) {
    const prevStart = value.lastIndexOf('\n', from - 2) + 1;
    const prev = value.slice(prevStart, from - 1);
    if (!tableLine(prev)) break;
    from = prevStart;
  }
  let to = nextNl === -1 ? value.length : nextNl;
  while (to < value.length) {
    const nextEnd = value.indexOf('\n', to + 1);
    const next = value.slice(to + 1, nextEnd === -1 ? value.length : nextEnd);
    if (!tableLine(next)) break;
    to = nextEnd === -1 ? value.length : nextEnd;
  }
  const rows: TableRow[] = [];
  let aligns: TableBlock['aligns'] = [];
  let at = from;
  for (const text of value.slice(from, to).split('\n')) {
    const separator = SEPARATOR.test(text) && rows.length === 1;
    if (separator) aligns = parseAligns(text);
    rows.push({ from: at, to: at + text.length, cells: splitCells(text, at), separator });
    at += text.length + 1;
  }
  if (rows.length < 2 || !rows[1]!.separator) return null;
  return { from, to, rows, aligns };
}

/** The row and column holding `caret` inside `table` (the last cell of a
 *  row when the caret sits past its pipes). */
export function cellAt(table: TableBlock, caret: number): { row: number; col: number } {
  let row = table.rows.findIndex((r) => caret >= r.from && caret <= r.to);
  if (row < 0) row = caret < table.from ? 0 : table.rows.length - 1;
  const cells = table.rows[row]!.cells;
  let col = cells.findIndex((c) => caret <= c.to + 1);
  if (col < 0) col = Math.max(0, cells.length - 1);
  return { row, col };
}

const cellText = (value: string, c: TableCell) => value.slice(c.from, c.to);

/** Every table in the text, in order. */
export function findTables(value: string): TableBlock[] {
  const out: TableBlock[] = [];
  let at = 0;
  while (at <= value.length) {
    const nl = value.indexOf('\n', at);
    const lineEnd = nl === -1 ? value.length : nl;
    const table = tableLine(value.slice(at, lineEnd)) ? tableAt(value, at) : null;
    if (table) {
      out.push(table);
      at = table.to + 1;
    } else at = lineEnd + 1;
  }
  return out;
}

/** The cells' text, row by row (the separator row included, empty). */
export function tableGrid(value: string, table: TableBlock): string[][] {
  return gridOf(value, table);
}

/** The table's text with the pipes lined up, and where the target cell's
 *  content sits in it (offsets relative to `from`). */
export function renderTable(
  grid: string[][],
  aligns: TableBlock['aligns'],
  from: number,
  target?: { row: number; col: number },
): { text: string; caretFrom: number; caretTo: number } {
  return render(grid, aligns, from, target);
}

/** Build the table back from its cells with the pipes lined up; the caret's
 *  cell is reported so a move can land in it. */
function render(
  grid: string[][],
  aligns: TableBlock['aligns'],
  from: number,
  target?: { row: number; col: number },
): { text: string; caretFrom: number; caretTo: number } {
  const cols = Math.max(...grid.map((r) => r.length), 1);
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    widths[c] = Math.max(3, ...grid.map((r, i) => (i === 1 ? 0 : (r[c] ?? '').length)));
  }
  let text = '';
  let caretFrom = from;
  let caretTo = from;
  grid.forEach((row, r) => {
    let line = '|';
    for (let c = 0; c < cols; c++) {
      const w = widths[c]!;
      if (r === 1) {
        const a = aligns[c] ?? null;
        const dashes = '-'.repeat(Math.max(1, w - (a === 'center' ? 2 : a ? 1 : 0)));
        const sep =
          a === 'center'
            ? `:${dashes}:`
            : a === 'right'
              ? `${dashes}:`
              : a === 'left'
                ? `:${dashes}`
                : dashes;
        line += ` ${sep.padEnd(w)} |`;
      } else {
        const cell = row[c] ?? '';
        const start = from + text.length + line.length + 1;
        if (target && target.row === r && target.col === c) {
          caretFrom = start;
          caretTo = start + cell.length;
        }
        line += ` ${cell.padEnd(w)} |`;
      }
    }
    text += line + (r < grid.length - 1 ? '\n' : '');
  });
  return { text, caretFrom, caretTo };
}

function gridOf(value: string, table: TableBlock): string[][] {
  return table.rows.map((r) => r.cells.map((c) => cellText(value, c)));
}

function replaceTable(
  s: EditState,
  table: TableBlock,
  grid: string[][],
  aligns: TableBlock['aligns'],
  target: { row: number; col: number },
): EditState {
  const out = render(grid, aligns, table.from, target);
  return {
    value: s.value.slice(0, table.from) + out.text + s.value.slice(table.to),
    selStart: out.caretFrom,
    selEnd: out.caretTo,
  };
}

/** Line the pipes up; the caret stays in its cell. */
export const tidyTable: EditAction = (s) => {
  const table = tableAt(s.value, s.selStart);
  if (!table) return s;
  return replaceTable(s, table, gridOf(s.value, table), table.aligns, cellAt(table, s.selStart));
};

/** Tab inside a table: the next cell (a new row after the last one);
 *  Shift+Tab the previous. Null when the caret is not in a table. */
export function tableNextCell(s: EditState, backwards: boolean): EditState | null {
  const table = tableAt(s.value, s.selStart);
  if (!table) return null;
  const grid = gridOf(s.value, table);
  const cols = Math.max(...grid.map((r) => r.length), 1);
  let { row, col } = cellAt(table, s.selStart);
  if (backwards) {
    if (col > 0) col--;
    else if (row > 0) {
      row = row === 2 ? 0 : row - 1;
      col = cols - 1;
    }
  } else if (col < cols - 1) col++;
  else {
    row = row === 0 ? 2 : row + 1;
    col = 0;
    if (row >= grid.length) grid.push(Array.from({ length: cols }, () => ''));
  }
  if (row === 1) row = 2;
  return replaceTable(s, table, grid, table.aligns, { row, col });
}

/** A fresh table at the caret, on lines of its own, caret in the first header cell. */
export function insertTable(cols: number, rows: number): EditAction {
  return ({ value, selStart, selEnd }) => {
    const before = value.slice(0, selStart);
    const after = value.slice(selEnd);
    const grid: string[][] = [
      Array.from({ length: cols }, (_, i) => `Column ${i + 1}`),
      Array.from({ length: cols }, () => ''),
      ...Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')),
    ];
    const lead =
      before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const tail =
      after.length === 0 || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
    const from = before.length + lead.length;
    const out = render(
      grid,
      Array.from({ length: cols }, () => null),
      from,
      { row: 0, col: 0 },
    );
    return {
      value: before + lead + out.text + tail + after,
      selStart: out.caretFrom,
      selEnd: out.caretTo,
    };
  };
}

export type TableEdit =
  | 'rowBelow'
  | 'rowAbove'
  | 'colRight'
  | 'colLeft'
  | 'deleteRow'
  | 'deleteCol'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight';

/** Rows, columns and alignment around the caret's cell. */
export function editTable(edit: TableEdit): EditAction {
  return (s) => {
    const table = tableAt(s.value, s.selStart);
    if (!table) return s;
    const grid = gridOf(s.value, table);
    const cols = Math.max(...grid.map((r) => r.length), 1);
    for (const r of grid) while (r.length < cols) r.push('');
    const aligns = [...table.aligns];
    while (aligns.length < cols) aligns.push(null);
    let { row, col } = cellAt(table, s.selStart);
    const blank = () => Array.from({ length: cols }, () => '');
    switch (edit) {
      case 'rowBelow': {
        const at = Math.max(row, 1) + 1;
        grid.splice(at, 0, blank());
        row = at;
        break;
      }
      case 'rowAbove': {
        const at = row <= 2 ? 2 : row;
        grid.splice(at, 0, blank());
        row = at;
        break;
      }
      case 'colRight':
        for (const r of grid) r.splice(col + 1, 0, '');
        aligns.splice(col + 1, 0, null);
        col += 1;
        break;
      case 'colLeft':
        for (const r of grid) r.splice(col, 0, '');
        aligns.splice(col, 0, null);
        break;
      case 'deleteRow':
        if (row < 2 || grid.length <= 3) return s; // the header and one row stay
        grid.splice(row, 1);
        row = Math.min(row, grid.length - 1);
        break;
      case 'deleteCol':
        if (cols <= 1) return s;
        for (const r of grid) r.splice(col, 1);
        aligns.splice(col, 1);
        col = Math.min(col, cols - 2);
        break;
      case 'alignLeft':
        aligns[col] = 'left';
        break;
      case 'alignCenter':
        aligns[col] = 'center';
        break;
      case 'alignRight':
        aligns[col] = 'right';
        break;
    }
    if (row === 1) row = 2;
    return replaceTable(s, table, grid, aligns, { row, col });
  };
}
