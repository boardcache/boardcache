import { useRef, useState } from 'react';
import type { ContactField } from '@boardcache/schema';
import { CloseIcon, ImageIcon, PlusIcon, TrashIcon } from '../../components/icons';
import { ContactAvatar } from '../../components/items/ContactContent';
import { UiDialog } from '../../components/ui/Dialog';
import { UiSelect } from '../../components/ui/Select';
import { putAsset } from '../../lib/board/assetStore';
import { clientToCanvas, getCanvasContainer } from '../../lib/canvas/canvasDom';
import { fitViewportTo } from '../../lib/canvas/viewportActions';
import { activePageId, revealItemPage } from '../../lib/board/pages';
import { createContactItem } from '../../lib/import/createItems';
import {
  FIELD_LABELS,
  SOCIAL_NETWORKS,
  contactListOf,
  defaultContactList,
  labelText,
  socialLabel,
} from '../../lib/structure/contacts';
import { removeItems, updateItems } from '../../state/commands';
import { useDocumentStore } from '../../state/documentStore';
import { useSessionStore } from '../../state/sessionStore';
import { useContactsUi } from './store';
import type { ContactForm } from './store';

/**
 * The contact editor: one dialog for a new card and for an existing one.
 * The name, where they work, then lists of emails, phones, web addresses
 * and postal addresses, each line with a label; a photo, a birthday and
 * notes. Fields fold into the item on save.
 */

export function ContactDialog() {
  const dialog = useContactsUi((s) => s.dialog);
  return dialog ? <ContactDialogBody key={dialog.itemId ?? 'new'} /> : null;
}

type ListKey = 'emails' | 'phones' | 'urls' | 'socials' | 'addresses' | 'fields';
interface ListSpec {
  key: ListKey;
  heading: string;
  add: string;
  placeholder: string;
  type: string;
  /** How the label is picked: from the usual set, from the networks, or typed. */
  label: 'pick' | 'network' | 'text';
}
const LISTS: ListSpec[] = [
  {
    key: 'emails',
    heading: 'Email',
    add: 'Add email',
    placeholder: 'name@example.com',
    type: 'email',
    label: 'pick',
  },
  {
    key: 'phones',
    heading: 'Phone',
    add: 'Add phone',
    placeholder: '+1 555 0100',
    type: 'tel',
    label: 'pick',
  },
  {
    key: 'urls',
    heading: 'Web',
    add: 'Add web address',
    placeholder: 'example.com',
    type: 'url',
    label: 'pick',
  },
  {
    key: 'socials',
    heading: 'Social',
    add: 'Add profile',
    placeholder: 'handle or profile link',
    type: 'text',
    label: 'network',
  },
  {
    key: 'addresses',
    heading: 'Address',
    add: 'Add address',
    placeholder: 'Street, city, country',
    type: 'text',
    label: 'pick',
  },
  {
    key: 'fields',
    heading: 'Custom fields',
    add: 'Add field',
    placeholder: 'Value',
    type: 'text',
    label: 'text',
  },
];

function LabelPick({
  value,
  onChange,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  testId: string;
}) {
  // An imported label outside the usual set stays pickable.
  const labels: string[] = [...FIELD_LABELS];
  if (value && !labels.includes(value)) labels.push(value);
  return (
    <UiSelect
      ariaLabel="Label"
      testId={testId}
      value={value}
      options={labels.map((l) => ({ value: l, label: l ? labelText(l) : 'No label' }))}
      onChange={onChange}
    />
  );
}

function NetworkPick({
  value,
  onChange,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  testId: string;
}) {
  const keys = SOCIAL_NETWORKS.map((n) => n.key);
  const v = value.trim().toLowerCase();
  if (v && !keys.includes(v)) keys.push(v); // an imported network stays pickable
  return (
    <UiSelect
      ariaLabel="Network"
      testId={testId}
      value={v}
      options={[
        { value: '', label: 'Network' },
        ...keys.map((k) => ({ value: k, label: socialLabel(k) })),
      ]}
      onChange={onChange}
    />
  );
}

function ContactDialogBody() {
  const { itemId, initial } = useContactsUi.getState().dialog!;
  const close = () => useContactsUi.getState().closeDialog();
  const [form, setForm] = useState<ContactForm>(initial);
  const set = (patch: Partial<ContactForm>) => setForm((f) => ({ ...f, ...patch }));
  const editing = itemId !== null;
  const photoInput = useRef<HTMLInputElement>(null);

  const setLine = (key: ListKey, i: number, patch: Partial<ContactField>) =>
    setForm((f) => ({ ...f, [key]: f[key].map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const addLine = (key: ListKey) =>
    setForm((f) => ({ ...f, [key]: [...f[key], { label: '', value: '' }] }));
  const removeLine = (key: ListKey, i: number) =>
    setForm((f) => ({ ...f, [key]: f[key].filter((_, j) => j !== i) }));

  const apply = () => {
    const trimLines = (list: ContactField[]) =>
      list.map((f) => ({ label: f.label.trim(), value: f.value.trim() })).filter((f) => f.value);
    const fields = {
      fullName: [form.givenName.trim(), form.familyName.trim()].filter(Boolean).join(' '),
      givenName: form.givenName.trim(),
      familyName: form.familyName.trim(),
      org: form.org.trim(),
      jobTitle: form.jobTitle.trim(),
      emails: trimLines(form.emails),
      phones: trimLines(form.phones),
      urls: trimLines(form.urls),
      addresses: trimLines(form.addresses),
      socials: trimLines(form.socials),
      fields: trimLines(form.fields),
      birthday: form.birthday || null,
      photoAssetId: form.photoAssetId,
    };
    const notes = form.notes.trim();
    if (itemId) {
      updateItems([itemId], 'Edit contact', (d) => {
        if (d.type !== 'contact') return;
        Object.assign(d, fields);
        if (notes) d.notes = notes;
        else delete d.notes;
      });
    } else {
      // A page that keeps a contact list files the new contact there; else a card.
      const center = clientToCanvas(window.innerWidth / 2, window.innerHeight / 2);
      const doc = useDocumentStore.getState().doc;
      const list = defaultContactList(doc, activePageId(doc));
      if (list) {
        createContactItem(
          { x: list.x, y: list.y },
          { ...fields, listId: list.id, ...(notes ? { notes } : {}) },
        );
        useSessionStore.getState().setSelection([list.id]);
      } else {
        createContactItem(center, { ...fields, ...(notes ? { notes } : {}) });
      }
    }
    close();
  };

  const showOnBoard = () => {
    if (!itemId) return;
    const doc = useDocumentStore.getState().doc;
    const item = doc.items[itemId];
    if (!item) return;
    close();
    // A listed contact is a row: the board shows its list.
    const target = contactListOf(doc, item) ?? item;
    const session = useSessionStore.getState();
    session.setLightbox(null);
    session.setView('canvas');
    session.setSelection([target.id]);
    revealItemPage(target.id);
    // The canvas mounts on the next frame when a view was showing.
    requestAnimationFrame(() => fitViewportTo(target, getCanvasContainer()));
  };

  const remove = () => {
    if (!itemId) return;
    close();
    removeItems([itemId], 'Delete contact');
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    const id = await putAsset(file);
    set({ photoAssetId: id });
  };

  const stop = (e: React.KeyboardEvent) => e.stopPropagation();
  // "Add to Board" or "Add to List": where a new contact lands.
  const listBound =
    !editing &&
    (() => {
      const doc = useDocumentStore.getState().doc;
      return defaultContactList(doc, activePageId(doc)) !== null;
    })();
  const preview = {
    fullName: '',
    givenName: form.givenName,
    familyName: form.familyName,
    org: form.org,
    photoAssetId: form.photoAssetId,
  };

  return (
    <UiDialog
      title={editing ? 'Edit Contact' : 'Add Contact'}
      onClose={close}
      className="contacts-sheet"
      size="wide"
      testId="contact-dialog"
    >
      <div className="plugin-settings-fields contacts-form">
        <div className="contacts-photo-row">
          <ContactAvatar item={preview} size={64} />
          <div className="contacts-photo-actions">
            <button
              type="button"
              className="btn btn-sm"
              data-testid="contact-photo-pick"
              onClick={() => photoInput.current?.click()}
            >
              <ImageIcon size={14} /> {form.photoAssetId ? 'Change photo' : 'Add photo'}
            </button>
            {form.photoAssetId && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                data-testid="contact-photo-remove"
                onClick={() => set({ photoAssetId: null })}
              >
                Remove
              </button>
            )}
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              hidden
              data-testid="contact-photo-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void pickPhoto(file);
              }}
            />
          </div>
        </div>
        <div className="contacts-grid">
          <label className="plugin-settings-field">
            <span>First name</span>
            <input
              value={form.givenName}
              autoFocus
              data-testid="contact-given"
              onChange={(e) => set({ givenName: e.target.value })}
              onKeyDown={(e) => {
                stop(e);
                if (e.key === 'Enter') apply();
              }}
            />
          </label>
          <label className="plugin-settings-field">
            <span>Last name</span>
            <input
              value={form.familyName}
              data-testid="contact-family"
              onChange={(e) => set({ familyName: e.target.value })}
              onKeyDown={(e) => {
                stop(e);
                if (e.key === 'Enter') apply();
              }}
            />
          </label>
          <label className="plugin-settings-field">
            <span>Organization</span>
            <input
              value={form.org}
              data-testid="contact-org"
              onChange={(e) => set({ org: e.target.value })}
              onKeyDown={stop}
            />
          </label>
          <label className="plugin-settings-field">
            <span>Job title</span>
            <input
              value={form.jobTitle}
              data-testid="contact-title"
              onChange={(e) => set({ jobTitle: e.target.value })}
              onKeyDown={stop}
            />
          </label>
        </div>
        {LISTS.map(({ key, heading, add, placeholder, type, label }) => (
          <div className="contacts-list-field" key={key} data-testid={`contact-list-${key}`}>
            <div className="contacts-list-head">
              <span>{heading}</span>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                data-testid={`contact-add-${key}`}
                onClick={() => addLine(key)}
              >
                <PlusIcon size={14} /> {add}
              </button>
            </div>
            {form[key].map((f, i) => (
              <div className="contacts-line" key={i}>
                {label === 'network' ? (
                  <NetworkPick
                    value={f.label}
                    testId={`contact-${key}-label-${i}`}
                    onChange={(label) => setLine(key, i, { label })}
                  />
                ) : label === 'text' ? (
                  <input
                    className="input"
                    value={f.label}
                    placeholder="Name"
                    aria-label="Field name"
                    data-testid={`contact-${key}-label-${i}`}
                    onChange={(e) => setLine(key, i, { label: e.target.value })}
                    onKeyDown={stop}
                  />
                ) : (
                  <LabelPick
                    value={f.label}
                    testId={`contact-${key}-label-${i}`}
                    onChange={(label) => setLine(key, i, { label })}
                  />
                )}
                <input
                  className="input"
                  type={type}
                  value={f.value}
                  placeholder={placeholder}
                  autoFocus={!f.value}
                  data-testid={`contact-${key}-value-${i}`}
                  onChange={(e) => setLine(key, i, { value: e.target.value })}
                  onKeyDown={stop}
                />
                <button
                  type="button"
                  className="contacts-line-remove"
                  aria-label={`Remove ${heading.toLowerCase()}`}
                  data-testid={`contact-${key}-remove-${i}`}
                  onClick={() => removeLine(key, i)}
                >
                  <CloseIcon size={14} />
                </button>
              </div>
            ))}
          </div>
        ))}
        <div className="contacts-grid">
          <label className="plugin-settings-field">
            <span>Birthday</span>
            <input
              type="date"
              value={form.birthday}
              data-testid="contact-birthday"
              onChange={(e) => set({ birthday: e.target.value })}
              onKeyDown={stop}
            />
          </label>
        </div>
        <label className="plugin-settings-field">
          <span>Notes</span>
          <textarea
            value={form.notes}
            rows={3}
            data-testid="contact-notes"
            onChange={(e) => set({ notes: e.target.value })}
            onKeyDown={stop}
          />
        </label>
        <div className="ui-prompt-actions">
          {editing && (
            <>
              <button type="button" data-testid="contact-delete" onClick={remove}>
                <TrashIcon size={14} /> Delete
              </button>
              <button type="button" data-testid="contact-show" onClick={showOnBoard}>
                Show on Board
              </button>
            </>
          )}
          <span className="contacts-spacer" />
          <button
            type="button"
            className="sync-primary"
            data-testid="contact-apply"
            onClick={apply}
          >
            {editing ? 'Save' : listBound ? 'Add to List' : 'Add to Board'}
          </button>
        </div>
      </div>
    </UiDialog>
  );
}
