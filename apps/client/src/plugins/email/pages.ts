import type { MailAccount } from './accounts';
import { fetchPage } from './mailApi';
import { emptyPage, pageKey, useEmailUi } from './store';

/** Load a folder page (the first, or the ones before the oldest read). */
export async function loadPage(account: MailAccount, folder: string, more = false): Promise<void> {
  const key = pageKey(account.id, folder);
  const ui = useEmailUi.getState();
  const have = ui.pages[key] ?? emptyPage();
  if (have.loading || (more && have.done)) return;
  ui.setPage(key, { loading: true, error: null });
  try {
    const page = await fetchPage(account, folder, more ? have.firstSeq : undefined);
    const messages = more ? [...have.messages, ...page.messages] : page.messages;
    useEmailUi.getState().setPage(key, {
      messages,
      exists: page.exists,
      firstSeq: page.firstSeq,
      loading: false,
      done: page.firstSeq <= 1 || page.messages.length === 0,
    });
  } catch (err) {
    useEmailUi.getState().setPage(key, {
      loading: false,
      error: err instanceof Error ? err.message : 'The folder could not be read.',
    });
  }
}
