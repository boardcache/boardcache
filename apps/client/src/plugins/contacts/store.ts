import { create } from 'zustand';
import type { ContactField, ContactItem } from '@boardcache/schema';

/** What the contact dialog edits: the form's own shape, folded into an item on save. */
export interface ContactForm {
  givenName: string;
  familyName: string;
  org: string;
  jobTitle: string;
  emails: ContactField[];
  phones: ContactField[];
  urls: ContactField[];
  addresses: ContactField[];
  /** Social profiles: the label names the network. */
  socials: ContactField[];
  /** Custom fields: any label, any text. */
  fields: ContactField[];
  /** `YYYY-MM-DD`, or '' for none. */
  birthday: string;
  notes: string;
  photoAssetId: string | null;
}

function emptyForm(): ContactForm {
  return {
    givenName: '',
    familyName: '',
    org: '',
    jobTitle: '',
    emails: [],
    phones: [],
    urls: [],
    addresses: [],
    socials: [],
    fields: [],
    birthday: '',
    notes: '',
    photoAssetId: null,
  };
}

function formFromItem(item: ContactItem): ContactForm {
  // A display name with no parts (an imported FN alone) edits as the given name.
  const parts = !item.givenName && !item.familyName && item.fullName;
  return {
    givenName: parts ? item.fullName : item.givenName,
    familyName: item.familyName,
    org: item.org,
    jobTitle: item.jobTitle,
    emails: item.emails.map((f) => ({ ...f })),
    phones: item.phones.map((f) => ({ ...f })),
    urls: item.urls.map((f) => ({ ...f })),
    addresses: item.addresses.map((f) => ({ ...f })),
    socials: item.socials.map((f) => ({ ...f })),
    fields: item.fields.map((f) => ({ ...f })),
    birthday: item.birthday && /^\d{4}-\d{2}-\d{2}$/.test(item.birthday) ? item.birthday : '',
    notes: item.notes ?? '',
    photoAssetId: item.photoAssetId,
  };
}

interface ContactsUi {
  dialog: { itemId: string | null; initial: ContactForm } | null;
  openNew: () => void;
  openEdit: (item: ContactItem) => void;
  closeDialog: () => void;
  /** Contacts view: the contact on the right, and the search box. */
  selectedId: string | null;
  setSelected: (id: string | null) => void;
  query: string;
  setQuery: (query: string) => void;
}

export const useContactsUi = create<ContactsUi>((set) => ({
  dialog: null,
  openNew: () => set({ dialog: { itemId: null, initial: emptyForm() } }),
  openEdit: (item) => set({ dialog: { itemId: item.id, initial: formFromItem(item) } }),
  closeDialog: () => set({ dialog: null }),
  selectedId: null,
  setSelected: (selectedId) => set({ selectedId }),
  query: '',
  setQuery: (query) => set({ query }),
}));
