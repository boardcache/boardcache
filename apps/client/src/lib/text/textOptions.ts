import type { TextAlign } from '@boardcache/schema';

/** Shared font/size choices for the text toolbar and Settings → Text. */
export const TEXT_SIZES = [
  { label: 'Small', value: 14 },
  { label: 'Medium', value: 18 },
  { label: 'Large', value: 24 },
  { label: 'Extra Large', value: 32 },
];

export const TEXT_FONTS = [
  { label: 'Sans', value: 'Inter, system-ui, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: 'ui-monospace, "Courier New", monospace' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times', value: '"Times New Roman", Times, serif' },
  { label: 'Courier', value: '"Courier New", monospace' },
];

export const TEXT_ALIGNS: TextAlign[] = ['left', 'center', 'right'];
