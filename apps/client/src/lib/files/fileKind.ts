/**
 * What a file is, from its name and media type, for the file card: the
 * family its icon comes from, a short label ("ZIP archive"), and whether
 * it is the kind of file a person should think twice about running.
 */

export type FileFamily =
  | 'archive'
  | 'spreadsheet'
  | 'code'
  | 'text'
  | 'data'
  | 'image'
  | 'audio'
  | 'video'
  | 'file';

export interface FileKind {
  family: FileFamily;
  /** "ZIP archive", "Spreadsheet", "DWG file". */
  label: string;
  /** The extension, lower-case, without the dot; '' when there is none. */
  ext: string;
}

const EXT_LABELS: Record<string, [FileFamily, string]> = {
  zip: ['archive', 'ZIP archive'],
  '7z': ['archive', '7-Zip archive'],
  rar: ['archive', 'RAR archive'],
  tar: ['archive', 'Tar archive'],
  gz: ['archive', 'Gzip archive'],
  tgz: ['archive', 'Tar archive'],
  bz2: ['archive', 'Bzip2 archive'],
  xz: ['archive', 'XZ archive'],
  xls: ['spreadsheet', 'Excel spreadsheet'],
  xlsx: ['spreadsheet', 'Excel spreadsheet'],
  xlsm: ['spreadsheet', 'Excel spreadsheet'],
  numbers: ['spreadsheet', 'Numbers spreadsheet'],
  ods: ['spreadsheet', 'Spreadsheet'],
  csv: ['spreadsheet', 'CSV table'],
  tsv: ['spreadsheet', 'TSV table'],
  json: ['data', 'JSON data'],
  xml: ['data', 'XML data'],
  yaml: ['data', 'YAML data'],
  yml: ['data', 'YAML data'],
  toml: ['data', 'TOML data'],
  sqlite: ['data', 'SQLite database'],
  db: ['data', 'Database'],
  js: ['code', 'JavaScript source'],
  ts: ['code', 'TypeScript source'],
  py: ['code', 'Python source'],
  rb: ['code', 'Ruby source'],
  rs: ['code', 'Rust source'],
  go: ['code', 'Go source'],
  java: ['code', 'Java source'],
  c: ['code', 'C source'],
  h: ['code', 'C header'],
  cpp: ['code', 'C++ source'],
  cs: ['code', 'C# source'],
  swift: ['code', 'Swift source'],
  kt: ['code', 'Kotlin source'],
  php: ['code', 'PHP source'],
  sh: ['code', 'Shell script'],
  css: ['code', 'Stylesheet'],
  scss: ['code', 'Stylesheet'],
  doc: ['text', 'Word document'],
  docx: ['text', 'Word document'],
  pages: ['text', 'Pages document'],
  odt: ['text', 'Text document'],
  rtf: ['text', 'Rich text'],
  txt: ['text', 'Plain text'],
  ppt: ['text', 'PowerPoint deck'],
  pptx: ['text', 'PowerPoint deck'],
  key: ['text', 'Keynote deck'],
  psd: ['image', 'Photoshop document'],
  ai: ['image', 'Illustrator file'],
  sketch: ['image', 'Sketch file'],
  fig: ['image', 'Figma file'],
  xcf: ['image', 'GIMP image'],
  raw: ['image', 'Raw photo'],
  cr2: ['image', 'Raw photo'],
  nef: ['image', 'Raw photo'],
  arw: ['image', 'Raw photo'],
  dng: ['image', 'Raw photo'],
  blend: ['image', 'Blender scene'],
  obj: ['image', '3D model'],
  fbx: ['image', '3D model'],
  glb: ['image', '3D model'],
  gltf: ['image', '3D model'],
  stl: ['image', '3D model'],
  dwg: ['image', 'CAD drawing'],
  dxf: ['image', 'CAD drawing'],
  aif: ['audio', 'Audio file'],
  aiff: ['audio', 'Audio file'],
  mid: ['audio', 'MIDI file'],
  midi: ['audio', 'MIDI file'],
  als: ['audio', 'Ableton project'],
  logicx: ['audio', 'Logic project'],
  prproj: ['video', 'Premiere project'],
  aep: ['video', 'After Effects project'],
  fcpbundle: ['video', 'Final Cut library'],
  exe: ['file', 'Windows program'],
  msi: ['file', 'Windows installer'],
  dmg: ['file', 'Mac disk image'],
  pkg: ['file', 'Mac installer'],
  app: ['file', 'Mac application'],
  apk: ['file', 'Android package'],
  iso: ['file', 'Disk image'],
};

/** Files that run when opened: the card asks before handing them over. */
const RUNNABLE = new Set([
  'exe',
  'msi',
  'bat',
  'cmd',
  'com',
  'scr',
  'ps1',
  'vbs',
  'js',
  'jar',
  'dmg',
  'pkg',
  'app',
  'apk',
  'sh',
  'command',
  'deb',
  'rpm',
  'appimage',
]);

export function fileExtension(name: string): string {
  const m = /\.([a-z0-9]{1,12})$/i.exec(name.trim());
  return m ? m[1]!.toLowerCase() : '';
}

/** The name without its extension, for the card's title. */
export function fileStem(name: string): string {
  const ext = fileExtension(name);
  return ext ? name.trim().slice(0, -(ext.length + 1)) : name.trim();
}

export function fileKind(name: string, mime = ''): FileKind {
  const ext = fileExtension(name);
  const known = EXT_LABELS[ext];
  if (known) return { family: known[0], label: known[1], ext };
  const m = mime.split(';')[0]!.trim().toLowerCase();
  const family: FileFamily = m.startsWith('image/')
    ? 'image'
    : m.startsWith('audio/')
      ? 'audio'
      : m.startsWith('video/')
        ? 'video'
        : m.startsWith('text/')
          ? 'text'
          : m.includes('zip') || m.includes('compressed') || m.includes('tar')
            ? 'archive'
            : m.includes('json') || m.includes('xml')
              ? 'data'
              : 'file';
  const label = ext
    ? `${ext.toUpperCase()} file`
    : m && m !== 'application/octet-stream'
      ? m
      : 'File';
  return { family, label, ext };
}

/** Whether a file of this name runs as a program when opened. */
export function isRunnableFile(name: string): boolean {
  return RUNNABLE.has(fileExtension(name));
}

/** "1.5 MB" — the card's size line. */
export function formatFileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
