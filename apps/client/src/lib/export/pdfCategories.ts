/** The Asset PDF's sections, in print order. Each item type names its section in src/itemTypes. */
export const PDF_CATEGORY_ORDER = [
  'image',
  'video',
  'storyboard',
  'audio',
  'pdf',
  'recipe',
  'text',
  'code',
  'font',
  'color',
  'shape',
  'webpage',
  'link',
] as const;
export type PdfCategory = (typeof PDF_CATEGORY_ORDER)[number];
export const PDF_CATEGORY_LABEL: Record<PdfCategory, string> = {
  recipe: 'Recipes',
  image: 'Images',
  storyboard: 'Storyboards',
  video: 'Videos',
  audio: 'Audio',
  pdf: 'PDFs',
  text: 'Text notes',
  code: 'Code',
  color: 'Colors',
  shape: 'Shapes',
  webpage: 'Webpages',
  link: 'Links',
  font: 'Fonts',
};
