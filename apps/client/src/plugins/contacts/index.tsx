import './style.css';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import type { ContactlistItem, Item } from '@boardcache/schema';
import {
  BoardsIcon,
  ContactIcon,
  ContactListIcon,
  FolderInputIcon,
  ListPlusIcon,
  PencilIcon,
} from '../../components/icons';
import { promptText } from '../../components/ui/Prompt';
import { activePageId } from '../../lib/board/pages';
import { clientToCanvas } from '../../lib/canvas/canvasDom';
import { contactsVcfText } from '../../lib/export/exportVcf';
import { createContactItem, createContactListItem } from '../../lib/import/createItems';
import { importVcfFiles, importVcfText } from '../../lib/import/importVcf';
import { attachContactsToList, sendContactsToBoard } from '../../lib/structure/contactList';
import { boardContacts, defaultContactList, listContacts } from '../../lib/structure/contacts';
import { requireLive, requireType } from '../../lib/tools/shared';
import { updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { openPluginView, registerPlugin } from '../registry';
import { ContactDialog } from './ContactDialog';
import { ContactsView } from './ContactsView';
import { useContactsUi } from './store';

/**
 * Contacts plugin: the UX for the core `contact` item type — the add/edit
 * dialog, vCard import and export, and the Contacts view (every contact on
 * the board as an address book, with notes).
 */

const PLUGIN_ID = 'contacts';
const VIEW_ID = 'contacts';

function viewCenter() {
  return clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
}

function openContacts(itemId?: string): void {
  if (itemId) useContactsUi.getState().setSelected(itemId);
  // The full view replaces whatever was showing — including the lightbox.
  useSessionStore.getState().setLightbox(null);
  openPluginView(VIEW_ID);
}

/** Rename a contact list (its Edit entry). */
async function renameList(itemId: string): Promise<void> {
  const item = useDocumentStore.getState().doc.items[itemId];
  if (item?.type !== 'contactlist') return;
  const title = await promptText({
    title: 'Rename list',
    label: 'Name',
    initial: item.title,
    confirmLabel: 'Rename',
  });
  if (title === null || !title.trim()) return;
  updateItems([itemId], 'Rename list', (d) => {
    if (d.type === 'contactlist') d.title = title.trim();
  });
}

/** File cards into the page's list, or a new list beside the first card. */
function putInList(ids: string[]): void {
  const doc = useDocumentStore.getState().doc;
  const first = ids.map((id) => doc.items[id]).find((it) => it?.type === 'contact');
  if (!first) return;
  const list = defaultContactList(doc, activePageId(doc));
  const listId =
    list?.id ??
    createContactListItem(
      { x: first.x + first.width + 200, y: first.y + 200 },
      {
        ...(first.pageId ? { pageId: first.pageId } : {}),
      },
    );
  attachContactsToList(ids, listId, list ? 'Add to list' : 'Put in a contact list');
}

function ContactsHost() {
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onEdit = (e: Event) => {
      const { itemId } = (e as CustomEvent<{ itemId: string }>).detail;
      const item = useDocumentStore.getState().doc.items[itemId];
      if (item?.type === 'contact') useContactsUi.getState().openEdit(item);
    };
    const onEditList = (e: Event) => {
      const { itemId } = (e as CustomEvent<{ itemId: string }>).detail;
      void renameList(itemId);
    };
    const onImport = () => fileInput.current?.click();
    const onOpen = (e: Event) => {
      const { itemId } = (e as CustomEvent<{ itemId?: string }>).detail ?? {};
      openContacts(itemId);
    };
    window.addEventListener('boardcache:open-contacts', onOpen);
    window.addEventListener('boardcache:edit-contact', onEdit);
    window.addEventListener('boardcache:edit-contactlist', onEditList);
    window.addEventListener('boardcache:import-contacts', onImport);
    return () => {
      window.removeEventListener('boardcache:open-contacts', onOpen);
      window.removeEventListener('boardcache:edit-contact', onEdit);
      window.removeEventListener('boardcache:edit-contactlist', onEditList);
      window.removeEventListener('boardcache:import-contacts', onImport);
    };
  }, []);
  return (
    <>
      <ContactDialog />
      <input
        ref={fileInput}
        type="file"
        accept=".vcf,text/vcard"
        multiple
        hidden
        data-testid="contacts-add-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void importVcfFiles(files, viewCenter());
        }}
      />
    </>
  );
}

const lineSchema = z.object({
  label: z.string().optional().describe('home, work, mobile, or any word'),
  value: z.string(),
});
const contactFields = {
  givenName: z.string().optional(),
  familyName: z.string().optional(),
  fullName: z.string().optional().describe('The display name; built from the parts when absent'),
  org: z.string().optional(),
  jobTitle: z.string().optional(),
  emails: z.array(lineSchema).optional(),
  phones: z.array(lineSchema).optional(),
  urls: z.array(lineSchema).optional(),
  socials: z
    .array(lineSchema)
    .optional()
    .describe(
      'Social profiles: the label is the network (x, instagram, linkedin, mastodon, bluesky, github, …), the value a handle or a URL',
    ),
  addresses: z.array(lineSchema).optional().describe('One line per address'),
  fields: z.array(lineSchema).optional().describe('Custom fields: any label with any text'),
  birthday: z
    .string()
    .nullable()
    .optional()
    .describe('YYYY-MM-DD, or --MM-DD without a year; null clears it'),
  notes: z.string().optional(),
};
const lines = (list: { label?: string | undefined; value: string }[] | undefined) =>
  list
    ?.map((f) => ({ label: f.label?.trim() ?? '', value: f.value.trim() }))
    .filter((f) => f.value);

registerPlugin({
  manifest: {
    id: PLUGIN_ID,
    order: 57,
    name: 'Contacts',
    description:
      'People and organisations as cards on the board, or filed in a contact list: import and export .vcf files, and an address book of everyone on the board with notes.',
  },
  addMenu: [
    {
      label: 'Add Contact',
      category: 'structure',
      icon: <ContactIcon />,
      onSelect: () => useContactsUi.getState().openNew(),
    },
    {
      label: 'Add Contact List',
      category: 'structure',
      icon: <ContactListIcon />,
      onSelect: () => createContactListItem(viewCenter()),
    },
    {
      label: 'Import Contacts',
      category: 'structure',
      icon: <FolderInputIcon />,
      onSelect: () => window.dispatchEvent(new CustomEvent('boardcache:import-contacts')),
    },
  ],
  Component: ContactsHost,
  itemMenu: (item) => {
    if (item.type === 'contact')
      return [
        {
          kind: 'action',
          label: 'Edit Contact',
          icon: <PencilIcon />,
          onSelect: () => useContactsUi.getState().openEdit(item),
        },
        {
          kind: 'action',
          label: 'Put in Contact List',
          icon: <ListPlusIcon />,
          onSelect: () => putInList([item.id]),
        },
        {
          kind: 'action',
          label: 'Open Contacts',
          icon: <ContactIcon />,
          onSelect: () => openContacts(item.id),
        },
      ];
    if (item.type === 'contactlist')
      return [
        {
          kind: 'action',
          label: 'Rename List',
          icon: <PencilIcon />,
          onSelect: () => void renameList(item.id),
        },
        {
          kind: 'action',
          label: 'Send All to Board',
          icon: <BoardsIcon />,
          onSelect: () =>
            sendContactsToBoard(
              listContacts(useDocumentStore.getState().doc, item.id).map((c) => c.id),
              'Send all to board',
            ),
        },
        {
          kind: 'action',
          label: 'Open Contacts',
          icon: <ContactIcon />,
          onSelect: () => openContacts(),
        },
      ];
    return [];
  },
  selectionMenu: (items: Item[]) => {
    const cards = items.filter((it) => it.type === 'contact');
    if (cards.length < 2) return [];
    return [
      {
        kind: 'action',
        label: 'Put in Contact List',
        icon: <ListPlusIcon />,
        onSelect: () => putInList(cards.map((c) => c.id)),
      },
    ];
  },
  views: [
    {
      id: VIEW_ID,
      label: 'Contacts',
      icon: <ContactIcon />,
      Component: ContactsView,
      // /b/:id/contacts[/:contactId]: the contact on the right.
      subPath: () => {
        const id = useContactsUi.getState().selectedId;
        return id ? [id] : [];
      },
      applySubPath: (segments) => {
        const [id] = segments;
        if (id && useDocumentStore.getState().doc.items[id]?.type === 'contact')
          useContactsUi.getState().setSelected(id);
      },
    },
  ],
  tools: [
    {
      name: 'add_contact',
      description:
        'Add a contact card to the board: a name (given and family, or a full name), where they work, emails, phones, web addresses and postal addresses with labels, a birthday and notes.',
      parameters: z.object({
        ...contactFields,
        x: z.number().optional(),
        y: z.number().optional(),
        placement: z
          .enum(['auto', 'list', 'card'])
          .optional()
          .describe(
            "Where it goes: 'list' files it in the page's contact list (made if none), 'card' puts a card on the canvas, 'auto' (default) files it when the page has a list",
          ),
      }),
      access: 'write',
      execute: (args, ctx) => {
        const center = ctx.viewCenter();
        const at = { x: args.x ?? center.x, y: args.y ?? center.y };
        const doc = ctx.doc();
        const placement = args.placement ?? 'auto';
        let list: ContactlistItem | null =
          placement === 'card' ? null : defaultContactList(doc, activePageId(doc));
        if (!list && placement === 'list') {
          const listId = createContactListItem(at);
          const made = useDocumentStore.getState().doc.items[listId];
          list = made?.type === 'contactlist' ? made : null;
        }
        const id = createContactItem(list ? { x: list.x, y: list.y } : at, {
          fullName: args.fullName ?? '',
          givenName: args.givenName ?? '',
          familyName: args.familyName ?? '',
          org: args.org ?? '',
          jobTitle: args.jobTitle ?? '',
          emails: lines(args.emails) ?? [],
          phones: lines(args.phones) ?? [],
          urls: lines(args.urls) ?? [],
          socials: lines(args.socials) ?? [],
          addresses: lines(args.addresses) ?? [],
          fields: lines(args.fields) ?? [],
          birthday: args.birthday ?? null,
          listId: list?.id ?? null,
          ...(args.notes?.trim() ? { notes: args.notes.trim() } : {}),
        });
        return { id, listId: list?.id ?? null };
      },
    },
    {
      name: 'add_contact_list',
      description:
        'Add a contact list to the board: one card that holds contacts as rows (the tidy way to keep many). Returns its id; file contacts into it with put_contacts_in_list or add_contact.',
      parameters: z.object({
        title: z.string().optional().describe('The list’s name (default "Contacts")'),
        x: z.number().optional(),
        y: z.number().optional(),
      }),
      access: 'write',
      execute: (args, ctx) => {
        const center = ctx.viewCenter();
        const id = createContactListItem(
          { x: args.x ?? center.x, y: args.y ?? center.y },
          args.title ? { title: args.title } : {},
        );
        return { id };
      },
    },
    {
      name: 'put_contacts_in_list',
      description:
        'File contact cards into a contact list (the given one, else the page’s list, made if none). Listed contacts leave the canvas and show as rows of the list; they keep their ids.',
      parameters: z.object({
        ids: z.array(z.string()).min(1).describe('Contact ids'),
        listId: z.string().optional(),
      }),
      access: 'write',
      execute: (args, ctx) => {
        const ids = requireLive(ctx, args.ids).map((id) => requireType(ctx, id, 'contact').id);
        let listId = args.listId;
        if (listId) requireType(ctx, requireLive(ctx, [listId])[0]!, 'contactlist');
        else {
          const doc = ctx.doc();
          listId = defaultContactList(doc, activePageId(doc))?.id;
          if (!listId) {
            const first = doc.items[ids[0]!]!;
            listId = createContactListItem({ x: first.x + first.width + 200, y: first.y + 200 });
          }
        }
        attachContactsToList(ids, listId);
        return { listId, count: ids.length };
      },
    },
    {
      name: 'send_contacts_to_board',
      description:
        'Take contacts out of their list onto the canvas as cards beside the list. Returns the ids that moved (contacts already on the canvas are left alone).',
      parameters: z.object({ ids: z.array(z.string()).min(1).describe('Contact ids') }),
      access: 'write',
      execute: (args, ctx) => {
        const ids = requireLive(ctx, args.ids).map((id) => requireType(ctx, id, 'contact').id);
        return { ids: sendContactsToBoard(ids) };
      },
    },
    {
      name: 'edit_contact',
      description:
        'Change a contact: any of its names, organisation, job title, the lists of emails, phones, web addresses, social profiles, postal addresses and custom fields (a list given replaces that list), birthday or notes.',
      parameters: z.object({ id: z.string(), ...contactFields }),
      access: 'write',
      execute: (args, ctx) => {
        const [id] = requireLive(ctx, [args.id]);
        requireType(ctx, id!, 'contact');
        updateItems([id!], 'Edit contact', (d) => {
          if (d.type !== 'contact') return;
          if (args.givenName !== undefined) d.givenName = args.givenName.trim();
          if (args.familyName !== undefined) d.familyName = args.familyName.trim();
          if (args.fullName !== undefined) d.fullName = args.fullName.trim();
          else if (args.givenName !== undefined || args.familyName !== undefined)
            d.fullName = [d.givenName, d.familyName].filter(Boolean).join(' ');
          if (args.org !== undefined) d.org = args.org.trim();
          if (args.jobTitle !== undefined) d.jobTitle = args.jobTitle.trim();
          if (args.emails !== undefined) d.emails = lines(args.emails) ?? [];
          if (args.phones !== undefined) d.phones = lines(args.phones) ?? [];
          if (args.urls !== undefined) d.urls = lines(args.urls) ?? [];
          if (args.socials !== undefined) d.socials = lines(args.socials) ?? [];
          if (args.addresses !== undefined) d.addresses = lines(args.addresses) ?? [];
          if (args.fields !== undefined) d.fields = lines(args.fields) ?? [];
          if (args.birthday !== undefined) d.birthday = args.birthday;
          if (args.notes !== undefined) {
            if (args.notes.trim()) d.notes = args.notes.trim();
            else delete d.notes;
          }
        });
        return { id };
      },
    },
    {
      name: 'export_contacts',
      description:
        'The board’s contacts (or the given ones) as vCard text (.vcf), ready to save or hand to an address book. Photos are left out.',
      parameters: z.object({ ids: z.array(z.string()).optional() }),
      access: 'read',
      execute: (args, ctx) => {
        const doc = ctx.doc();
        const items = args.ids?.length
          ? requireLive(ctx, args.ids).map((id) => requireType(ctx, id, 'contact'))
          : boardContacts(doc);
        return { count: items.length, vcf: contactsVcfText(items) };
      },
    },
    {
      name: 'import_contacts',
      description:
        'Add contacts from vCard text (.vcf): every card becomes a contact. Several file into a contact list (the page’s, else a new one at the given point); one lands as a card unless the page has a list. Returns the new ids.',
      parameters: z.object({
        vcf: z.string(),
        x: z.number().optional(),
        y: z.number().optional(),
        placement: z
          .enum(['auto', 'list', 'cards'])
          .optional()
          .describe(
            "'list' always files them, 'cards' always lays cards out, 'auto' (default) as described",
          ),
      }),
      access: 'write',
      execute: async (args, ctx) => {
        const center = ctx.viewCenter();
        const ids = await importVcfText(
          args.vcf,
          { x: args.x ?? center.x, y: args.y ?? center.y },
          args.placement ?? 'auto',
        );
        return { ids };
      },
    },
  ],
});
